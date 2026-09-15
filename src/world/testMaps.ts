import { CELL } from '../core/config';
import type { ObjectClass } from '../collect/memoryObject';
import type { Vec2 } from '../math/vec2';
import { Grid } from './grid';

export interface ObjectPlacement {
  cls: ObjectClass;
  center: Vec2;
}

export interface TestMap {
  grid: Grid;
  spawn: Vec2;
  objects: ObjectPlacement[];
}

/**
 * Этап 1: большая комната с колонной, узкий проход (2 клетки) в боковую комнату
 * и петля широким проходом (3 клетки) обратно — чтобы проверить повороты, скольжение по стенам и углы.
 */
export const movementTestMap = (): TestMap => {
  const g = new Grid(28, 20);
  g.carveRect(2, 2, 12, 12); // главная комната
  g.fillRect(6, 6, 2, 2); // колонна
  g.carveRect(14, 7, 4, 2); // проход A, ширина 2
  g.carveRect(18, 4, 6, 6); // боковая комната 6×6
  g.carveRect(19, 10, 3, 7); // проход B вниз, ширина 3
  g.carveRect(8, 14, 2, 1); // проход D из главной комнаты вниз
  g.carveRect(8, 15, 11, 2); // проход C, ширина 2
  g.cutCorners();
  return { grid: g, spawn: { x: 5 * CELL, y: -10 * CELL }, objects: [] };
};

/**
 * Этап 2: та же карта, но главная комната без колонны и с одним большим объектом в центре —
 * его можно стирать с любого направления (§7).
 */
export const collectTestMap = (): TestMap => {
  const g = new Grid(28, 20);
  g.carveRect(2, 2, 12, 12); // главная комната 12×12
  g.carveRect(14, 7, 4, 2); // проход A, ширина 2
  g.carveRect(18, 4, 6, 6); // боковая комната 6×6
  g.carveRect(19, 10, 3, 7); // проход B вниз, ширина 3
  g.carveRect(8, 14, 2, 1); // проход D из главной комнаты вниз
  g.carveRect(8, 15, 11, 2); // проход C, ширина 2
  g.cutCorners();
  const roomCenter = { x: 8 * CELL, y: -8 * CELL };
  return {
    grid: g,
    spawn: { x: 3.5 * CELL, y: -12.5 * CELL },
    objects: [{ cls: 'large', center: roomCenter }],
  };
};
