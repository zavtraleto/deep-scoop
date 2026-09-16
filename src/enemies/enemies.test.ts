import { describe, expect, it } from 'vitest';
import { enemyConfig, PLAYER_RADIUS } from '../core/config';
import { Grid } from '../world/grid';
import { EnemySystem, type EnemyWorld } from './enemySystem';
import { cellCenter, enemyGrid, NavGrid, segmentClear } from './navGrid';

/**
 * Две комнаты 8×6, между ними стена с проходом внизу:
 * левая x 1..8, правая x 10..17, стена x = 9, проход в строках 5..6.
 */
const twoRooms = () => {
  const g = new Grid(20, 10);
  g.carveRect(1, 1, 8, 6);
  g.carveRect(10, 1, 8, 6);
  g.carveRect(9, 5, 1, 2);
  return g;
};

const setup = (blocked = [] as { x: number; y: number; w: number; h: number }[]) => {
  const grid = twoRooms();
  const eg = enemyGrid(grid, blocked);
  const nav = new NavGrid(eg);
  const bodyWalls = eg.buildWalls();
  const sightWalls = grid.buildWalls();
  return { grid, nav, bodyWalls, sightWalls };
};

const world = (player: { x: number; y: number }, extra: Partial<EnemyWorld> = {}): EnemyWorld => ({
  player,
  playerVel: { x: 0, y: 0 },
  playerRadius: PLAYER_RADIUS,
  noisy: false,
  cargoRatio: 0,
  ...extra,
});

const run = (sys: EnemySystem, seconds: number, w: EnemyWorld) => {
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) {
    sys.step(dt, w);
    if (sys.caught) return true;
  }
  return false;
};

describe('навигация врагов', () => {
  it('путь обходит стену через проход', () => {
    const { nav } = setup();
    const from = cellCenter(3, 2);
    const to = cellCenter(15, 2);
    const { points, reached } = nav.findPath(from, to);
    expect(reached).toBe(true);
    expect(points.at(-1)).toEqual(to);
    // Путь проходит через клетки прохода (x = 9, строки 5–6).
    expect(points.some((p) => Math.floor(p.x / 2) === 9 && Math.floor(-p.y / 2) >= 5)).toBe(true);
  });

  it('недостижимая цель — путь к ближайшей доступной клетке', () => {
    const { nav } = setup();
    const inWall = cellCenter(9, 2); // сплошная стена между комнатами
    const { points, reached } = nav.findPath(cellCenter(3, 2), inWall);
    expect(reached).toBe(false);
    const last = points.at(-1)!;
    expect(Math.hypot(last.x - inWall.x, last.y - inWall.y)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('запретная зона закрыта и для пути, и для тела', () => {
    const { nav, bodyWalls } = setup([{ x: 10, y: 1, w: 8, h: 6 }]);
    const { reached } = nav.findPath(cellCenter(3, 2), cellCenter(15, 2));
    expect(reached).toBe(false);
    expect(segmentClear(bodyWalls, cellCenter(3, 5), cellCenter(15, 5), 0)).toBe(false);
  });

  it('прямая видимость перекрывается стеной', () => {
    const { sightWalls } = setup();
    expect(segmentClear(sightWalls, cellCenter(3, 2), cellCenter(6, 3), 0)).toBe(true);
    expect(segmentClear(sightWalls, cellCenter(3, 2), cellCenter(15, 2), 0)).toBe(false);
    // Круг радиуса 1 у самой стены не проходит.
    expect(segmentClear(sightWalls, { x: 3, y: -2.6 }, { x: 15, y: -2.6 }, 1)).toBe(false);
  });
});

describe('Hunter', () => {
  const hunterAt = (cx: number, cy: number, params = enemyConfig) => {
    const s = setup();
    return new EnemySystem([{ kind: 'hunter', pos: cellCenter(cx, cy) }], s.nav, s.bodyWalls, s.sightWalls, params);
  };

  it('без событий обнаружения не знает, где игрок, и стоит', () => {
    const sys = hunterAt(15, 2);
    const player = cellCenter(3, 2); // за стеной, вне видимости
    run(sys, 3, world(player));
    const e = sys.enemies[0];
    expect(e.info).toBeNull();
    expect(Math.hypot(e.pos.x - e.home.x, e.pos.y - e.home.y)).toBeLessThan(0.01);
  });

  it('пульс слышен сквозь стену и доходит со скоростью волны', () => {
    const sys = hunterAt(15, 2);
    const player = cellCenter(3, 2);
    const speed = 10;
    const dist = Math.hypot(cellCenter(15, 2).x - player.x, 0); // 24 ед.
    sys.pulse(player, { x: 3, y: 0 }, speed);
    run(sys, dist / speed - 0.1, world(player));
    expect(sys.enemies[0].info).toBeNull();
    run(sys, 0.2, world(player));
    const info = sys.enemies[0].info!;
    expect(info.source).toBe('pulse');
    expect(info.pos).toEqual(player);
    expect(info.dir).toEqual({ x: 1, y: 0 });
    expect(sys.pings).toHaveLength(1);
  });

  it('вне радиуса пульса не слышит', () => {
    const sys = hunterAt(15, 2, { ...enemyConfig, pulseHearRadius: 10 });
    sys.pulse(cellCenter(3, 2), { x: 0, y: 0 }, 40);
    run(sys, 2, world(cellCenter(3, 2)));
    expect(sys.enemies[0].info).toBeNull();
  });

  it('идёт к последней известной позиции через проход и ждёт там', () => {
    const sys = hunterAt(15, 2);
    const lastKnown = cellCenter(3, 2);
    sys.pulse(lastKnown, { x: 0, y: 0 }, 1000);
    // Игрок уже ушёл далеко, за пределы видимости и слышимости шума.
    const player = { x: -500, y: 500 };
    run(sys, 15, world(player));
    const e = sys.enemies[0];
    expect(Math.hypot(e.pos.x - lastKnown.x, e.pos.y - lastKnown.y)).toBeLessThan(enemyConfig.arriveRadius + 0.3);
    expect(e.arrived).toBe(true);
    const at = { ...e.pos };
    run(sys, 2, world(player));
    expect(Math.hypot(e.pos.x - at.x, e.pos.y - at.y)).toBeLessThan(0.3);
  });

  it('видит вблизи, догоняет и ловит; за стеной теряет из виду', () => {
    const sys = hunterAt(15, 2);
    expect(run(sys, 6, world(cellCenter(12, 3)))).toBe(true);

    const hidden = hunterAt(15, 2);
    run(hidden, 0.5, world(cellCenter(6, 2))); // 18 ед., за стеной
    expect(hidden.enemies[0].sees).toBe(false);
    expect(hidden.enemies[0].info).toBeNull();
  });

  it('шум сбора выдаёт позицию ближним врагам', () => {
    const sys = hunterAt(15, 2);
    const player = cellCenter(6, 2); // за стеной, 18 ед.
    run(sys, 0.1, world(player, { noisy: true }));
    expect(sys.enemies[0].info?.source).toBe('noise');
  });

  it('груз увеличивает радиус обнаружения', () => {
    const params = { ...enemyConfig, noiseRadius: 15 };
    const player = cellCenter(6, 2); // 18 ед.
    const light = hunterAt(15, 2, params);
    run(light, 0.1, world(player, { noisy: true, cargoRatio: 0.2 }));
    expect(light.enemies[0].info).toBeNull();
    const heavy = hunterAt(15, 2, params);
    run(heavy, 0.1, world(player, { noisy: true, cargoRatio: 0.6 }));
    expect(heavy.enemies[0].info).not.toBeNull();
  });

  it('сброс возвращает врага домой и стирает знание', () => {
    const sys = hunterAt(15, 2);
    sys.pulse(cellCenter(3, 2), { x: 0, y: 0 }, 1000);
    run(sys, 2, world({ x: -500, y: 500 }));
    sys.reset();
    const e = sys.enemies[0];
    expect(e.info).toBeNull();
    expect(e.pos).toEqual(e.home);
  });
});
