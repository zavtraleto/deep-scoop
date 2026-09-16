import { describe, expect, it } from 'vitest';
import { CELL } from '../core/config';
import { Grid } from '../world/grid';
import { HIDDEN, MapKnowledge, type Tracked } from './mapKnowledge';

/** Две комнаты за сплошной стеной без прохода: левая x 1..8, правая x 12..19. */
const walls = () => {
  const g = new Grid(24, 8);
  g.carveRect(1, 1, 8, 5);
  g.carveRect(12, 1, 8, 5);
  return g.buildWalls();
};

const SPEED = 10;
const run = (m: MapKnowledge, from: number, to: number, tracked: Tracked[] = [], radius = 100) => {
  for (let t = from; t <= to; t += 1 / 60) m.step(t, SPEED, radius, tracked, 4);
};

describe('карта', () => {
  it('развёртка стен не открывает, но засекает точки сквозь скалу', () => {
    const m = new MapKnowledge(walls());
    const behindRock = { key: {}, kind: 'enemy' as const, pos: { x: 30, y: -6 } }; // в правой комнате
    m.fire({ x: 3 * CELL, y: -3 * CELL }, 0);
    run(m, 0, 5, [behindRock]);
    expect(m.segments.every((_, i) => m.revealed[i] === HIDDEN)).toBe(true);
    expect(m.changed).toHaveLength(0);
    expect(m.blips.get(behindRock.key)?.pos).toEqual({ x: 30, y: -6 });
  });

  it('дальше радиуса точек нет, законченная развёртка исчезает', () => {
    const m = new MapKnowledge(walls());
    const far = { key: {}, kind: 'item' as const, pos: { x: 40, y: -6 } };
    m.fire({ x: 2, y: -6 }, 0);
    run(m, 0, 5, [far], 12);
    expect(m.blips.size).toBe(0);
    expect(m.sweeping).toBe(0);
  });

  it('клетка, увиденная игроком, открывает свои контуры', () => {
    const m = new MapKnowledge(walls());
    m.revealCell(1 * 24 + 1, 5); // угол левой комнаты
    expect(m.changed.length).toBeGreaterThanOrEqual(2);
    for (const i of m.changed) expect(m.revealed[i]).toBe(5);
  });

  it('точки: предмет и враг там, где их застал фронт', () => {
    const m = new MapKnowledge(walls());
    const item = { key: {}, kind: 'item' as const, pos: { x: 30, y: -6 } };
    const enemy = { key: {}, kind: 'enemy' as const, pos: { x: 34, y: -6 } };
    m.fire({ x: 6, y: -6 }, 0);
    run(m, 0, 2.2, [item, enemy]); // фронт 22 ед.: предмет (24) ещё не засечён
    expect(m.blips.size).toBe(0);
    run(m, 2.2, 2.6, [item, enemy]); // 26: предмет засечён
    expect(m.blips.get(item.key)?.pos).toEqual({ x: 30, y: -6 });
    enemy.pos = { x: 50, y: -6 }; // враг уплывает дальше от фронта
    run(m, 2.6, 5, [item, enemy]);
    expect(m.blips.get(enemy.key)?.pos).toEqual({ x: 50, y: -6 });
    // Точка врага гаснет через enemyLife, предмет остаётся.
    run(m, 5, 10, [item, enemy]);
    expect(m.blips.has(enemy.key)).toBe(false);
    expect(m.blips.has(item.key)).toBe(true);
  });

  it('следующая развёртка стирает точку исчезнувшего предмета и переносит уплывший', () => {
    const m = new MapKnowledge(walls());
    const gone = { key: {}, kind: 'item' as const, pos: { x: 20, y: -6 } };
    const moved = { key: {}, kind: 'item' as const, pos: { x: 26, y: -6 } };
    m.fire({ x: 6, y: -6 }, 0);
    run(m, 0, 4, [gone, moved]);
    expect(m.blips.size).toBe(2);
    moved.pos = { x: 36, y: -6 };
    m.fire({ x: 6, y: -6 }, 20);
    run(m, 20, 30, [moved]); // gone стёрт — его нет среди отслеживаемых
    expect(m.blips.has(gone.key)).toBe(false);
    expect(m.blips.get(moved.key)?.pos).toEqual({ x: 36, y: -6 });
  });
});
