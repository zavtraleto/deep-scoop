import { describe, expect, it } from 'vitest';
import { CELL } from '../core/config';
import { resolveCircleVsWalls } from './collision';
import { Cell, Grid } from './grid';

describe('Grid.cutCorners', () => {
  it('срезает внутренние углы комнаты', () => {
    const g = new Grid(6, 6);
    g.carveRect(1, 1, 4, 4);
    g.cutCorners();
    expect(g.get(1, 1)).toBe(Cell.DiagTL);
    expect(g.get(4, 1)).toBe(Cell.DiagTR);
    expect(g.get(1, 4)).toBe(Cell.DiagBL);
    expect(g.get(4, 4)).toBe(Cell.DiagBR);
    expect(g.get(2, 2)).toBe(Cell.Empty);
    expect(g.get(0, 0)).toBe(Cell.Solid);
  });

  it('срезает внешние углы у входа в проход', () => {
    const g = new Grid(10, 8);
    g.carveRect(1, 1, 4, 6);
    g.carveRect(5, 3, 3, 2); // проход вправо из середины стены
    g.cutCorners();
    expect(g.get(5, 2)).toBe(Cell.DiagTR);
    expect(g.get(5, 5)).toBe(Cell.DiagBR);
  });

  it('на ступеньке в одну клетку не создаёт торчащих зубцов', () => {
    const g = new Grid(12, 8);
    g.carveRect(6, 1, 4, 6); // комната
    g.carveRect(1, 3, 5, 3); // проход, нижний край (ряд 5) на клетку выше пола комнаты (ряд 6)
    g.cutCorners();
    // Внешний угол под проходом (5,6) и внутренний угол комнаты (6,6) — ступенька; срезать нельзя ни один.
    expect(g.get(5, 6)).toBe(Cell.Solid);
    expect(g.get(6, 6)).toBe(Cell.Empty);
  });
});

describe('Grid.buildWalls', () => {
  it('комната 1×1 даёт замкнутый контур из 4 отрезков', () => {
    const g = new Grid(3, 3);
    g.carveRect(1, 1, 1, 1);
    expect(g.buildWalls().all).toHaveLength(4);
  });

  it('диагональ даёт гипотенузу вместо двух сторон', () => {
    const g = new Grid(4, 4);
    g.carveRect(1, 1, 2, 2);
    g.set(1, 1, Cell.DiagTL);
    // 8 сторон контура 2×2, минус 2 закрытые стороны диагонали внутри, плюс 2 стороны соседей, плюс гипотенуза.
    const walls = g.buildWalls().all;
    const diagonal = walls.filter((s) => s.ax !== s.bx && s.ay !== s.by);
    expect(diagonal).toHaveLength(1);
    expect(walls).toHaveLength(7);
  });
});

describe('resolveCircleVsWalls', () => {
  const room = () => {
    const g = new Grid(5, 5);
    g.carveRect(1, 1, 3, 3);
    g.cutCorners();
    return g.buildWalls();
  };

  it('выталкивает из стены и гасит скорость в стену, сохраняя скольжение', () => {
    const walls = room();
    const left = 1 * CELL;
    const pos = { x: left + 0.3, y: -2.5 * CELL };
    const vel = { x: -5, y: 2 };
    expect(resolveCircleVsWalls(pos, vel, 0.5, walls)).toBe(true);
    expect(pos.x).toBeCloseTo(left + 0.5);
    expect(vel.x).toBe(0);
    expect(vel.y).toBe(2);
  });

  it('в центре комнаты касаний нет', () => {
    const walls = room();
    const pos = { x: 2.5 * CELL, y: -2.5 * CELL };
    const vel = { x: 1, y: 1 };
    expect(resolveCircleVsWalls(pos, vel, 0.5, walls)).toBe(false);
  });

  it('не даёт пройти сквозь срезанный угол', () => {
    const walls = room();
    // Угол (1,1) срезан: гипотенуза x - y = 6 идёт из (2, -4) в (4, -2), комната со стороны x - y > 6.
    const n = Math.SQRT1_2;
    const pos = { x: 3 + n * 0.2, y: -3 - n * 0.2 };
    const vel = { x: -1, y: 1 };
    expect(resolveCircleVsWalls(pos, vel, 0.5, walls)).toBe(true);
    expect(vel.x).toBeCloseTo(0);
    expect(vel.y).toBeCloseTo(0);
    // Расстояние до линии x - y = 6 (гипотенуза) должно быть ≥ радиуса, со стороны комнаты.
    const signed = (pos.x - pos.y - 6) / Math.SQRT2;
    expect(signed).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });
});
