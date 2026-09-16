import { describe, expect, it } from 'vitest';
import { CELL, visionConfig } from '../core/config';
import { Grid } from '../world/grid';
import { EchoPulse } from './echoPulse';
import { castVisibility, isVisible, lightStrength, marchRay } from './light';
import { ShardField } from './shards';
import { VisibilityMap } from './visibility';

const light = visionConfig.light;
const echoParams = visionConfig.echo;

/** Комната 10×10 клеток со стеной-перегородкой по x = 10 ед. (клетка 5) от y 0 до −12 ед. */
const roomWithWall = () => {
  const g = new Grid(12, 12);
  g.carveRect(1, 1, 10, 10);
  g.fillRect(5, 1, 1, 5);
  return g;
};

describe('свет', () => {
  it('круг вокруг и луч вперёд по носу', () => {
    expect(lightStrength(0, 1, 0, light)).toBeGreaterThan(0.9); // рядом — светло с любой стороны
    expect(lightStrength(-6, 0, 0, light)).toBe(0); // сзади на 3 клетках — темно
    expect(lightStrength(4, 0, 0, light)).toBeGreaterThan(0.9); // впереди на 2 клетках — луч в полную силу
    expect(lightStrength(6, 0, 0, light)).toBeGreaterThan(0.5); // на 3 клетках — край луча мягко гаснет
    expect(lightStrength(6, 6, 0, light)).toBe(0); // вне ширины луча
  });

  it('стена отбрасывает тень', () => {
    const g = roomWithWall();
    const walls = g.buildWalls();
    // Игрок слева от перегородки, смотрит вправо: за перегородкой темно, под ней — видно.
    const origin = { x: 7, y: -5 };
    const poly = castVisibility(origin, 0, walls, light);
    expect(isVisible(poly, { x: 13, y: -5 })).toBe(false);
    expect(isVisible(poly, { x: 9, y: -5 })).toBe(true);
    expect(isVisible(poly, { x: 7, y: -8 })).toBe(true); // вниз в пределах круга света — ничего не мешает
  });

  it('свет отмечает клетки увиденными, но не за стеной', () => {
    const g = roomWithWall();
    const map = new VisibilityMap(g.width, g.height);
    const poly = castVisibility({ x: 7, y: -5 }, 0, g.buildWalls(), light);
    map.exploreByLight(poly, 0, light);
    expect(map.isExplored(3, 2)).toBe(true); // клетка игрока
    expect(map.isExplored(5, 2)).toBe(true); // сама перегородка видна
    expect(map.isExplored(7, 2)).toBe(false); // за перегородкой
    expect(map.isExplored(0, 2)).toBe(false); // позади вне круга — нет (клетка 0 в 7 ед.)
  });
});

describe('дальний луч по клеткам', () => {
  it('совпадает с полным перебором стен', () => {
    const g = roomWithWall();
    const walls = g.buildWalls();
    const origin = { x: 7.3, y: -5.6 };
    const brute = castVisibility(origin, 0, walls, { radius: 30, coneRange: 30, coneAngleDeg: 0, softness: 0 }, 90);
    brute.angles.forEach((a, i) => {
      expect(marchRay(walls, origin.x, origin.y, a, 30)).toBeCloseTo(brute.radii[i], 6);
    });
  });
});

describe('эхо', () => {
  it('срабатывает по интервалу и не проходит сквозь стены', () => {
    const g = roomWithWall();
    const walls = g.buildWalls();
    const map = new VisibilityMap(g.width, g.height);
    const echo = new EchoPulse(echoParams);
    const dt = 1 / 120;
    let fired = 0;
    for (let t = 0; t < echoParams.interval + 0.5; t += dt) {
      echo.step(dt, { x: 7, y: -5 }, map, walls, t);
      fired += echo.firedThisStep;
    }
    expect(fired).toBe(1);
    expect(map.isExplored(1, 8)).toBe(true); // далеко, но в прямой видимости
    expect(map.echoLevel(8 * g.width + 1, echoParams.interval + 0.5, echoParams.glow)).toBeGreaterThan(0);
    expect(map.isExplored(5, 2)).toBe(true); // сама перегородка видна
    expect(map.isExplored(7, 2)).toBe(false); // за перегородкой — тень
  });

  it('кольцо не раскрывает дальше радиуса', () => {
    const g = new Grid(40, 40, 0);
    const map = new VisibilityMap(40, 40);
    const params = { ...echoParams, interval: 0.01, radius: 16 };
    const echo = new EchoPulse(params);
    for (let t = 0; t < 1.5; t += 1 / 120) echo.step(1 / 120, { x: 1, y: -1 }, map, g.buildWalls(), t);
    const far = Math.ceil(params.radius / CELL) + 2;
    expect(map.isExplored(far, 0)).toBe(false);
    expect(map.isExplored(far - 3, 0)).toBe(true);
  });

  it('осколок приближает импульс; переполнение — импульс сразу, остаток сгорает', () => {
    const map = new VisibilityMap(10, 10);
    const walls = new Grid(10, 10, 0).buildWalls();
    const echo = new EchoPulse(echoParams);
    echo.step(0.1, { x: 0, y: 0 }, map, walls, 0);
    const before = echo.countdown;
    echo.boost(1);
    expect(echo.countdown).toBeCloseTo(before - 0.3);
    echo.boost(20);
    echo.step(0.01, { x: 0, y: 0 }, map, walls, 0.1);
    expect(echo.firedThisStep).toBe(1);
    expect(echo.countdown).toBeCloseTo(echoParams.interval);
    expect(echo.charge).toBeCloseTo(0);
  });
});

describe('осколки', () => {
  it('магнит подтягивает рядом и подбирает, дальние не трогает', () => {
    const field = new ShardField([
      { x: 0.9, y: 0 },
      { x: 5, y: 0 },
    ]);
    let picked = 0;
    for (let t = 0; t < 1; t += 1 / 120) picked += field.step({ x: 0, y: 0 }, 1 / 120, visionConfig.shards);
    expect(picked).toBe(1);
    expect(field.alive).toEqual([false, true]);
    expect(field.pos[1]).toEqual({ x: 5, y: 0 });
  });
});
