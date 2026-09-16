import type { ObjectClass } from '../collect/memoryObject';
import type { EnemyKind } from '../enemies/enemy';
import { CELL } from '../core/config';
import type { Vec2 } from '../math/vec2';
import { Cell, Grid } from '../world/grid';
import { corridorGeometries, type CorridorGeometry } from './geometry';
import { chunkSize, objectClass, type CellRect, type ChunkLayout, type RoomSpec } from './layout';
import { roomFloorMask } from './roomShape';
import { validateLayout } from './validate';

export interface ObjectPlacement {
  cls: ObjectClass;
  center: Vec2;
  roomId: string;
  /** Ключ места для детерминированного выбора картинки. */
  key: string;
  /** Явно заданная картинка (ручная карта). */
  art?: string;
}

/** Готовый чанк: сетка клеток и всё, что нужно расставить в мире (координаты мира). */
export interface ChunkMap {
  layout: ChunkLayout;
  grid: Grid;
  corridors: CorridorGeometry[];
  spawn: Vec2;
  objects: ObjectPlacement[];
  enemies: EnemyPlacement[];
  /** Куда врагам нельзя (база, §4.7), клетки чанка. */
  enemyBlocked: CellRect[];
}

export interface EnemyPlacement {
  kind: EnemyKind;
  pos: Vec2;
  roomId: string;
}

const ENEMY_CLEARANCE = 0.8; // ед. свободного пола вокруг точки появления врага

/** Центр прямоугольника клеток в мировых координатах. */
export const rectCenter = (r: CellRect): Vec2 => ({ x: (r.x + r.w / 2) * CELL, y: -(r.y + r.h / 2) * CELL });

const cellOf = (p: Vec2) => ({ cx: Math.floor(p.x / CELL), cy: Math.floor(-p.y / CELL) });

/** Точка стоит на полу с запасом ~radius во все стороны. */
const onFloor = (grid: Grid, p: Vec2, radius: number): boolean => {
  for (const [dx, dy] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
    const { cx, cy } = cellOf({ x: p.x + dx, y: p.y + dy });
    if (grid.get(cx, cy) !== Cell.Empty) return false;
  }
  return true;
};

/** Ближайшая к p точка пола с запасом radius: обход по расширяющимся кольцам. */
const nearestFloor = (grid: Grid, p: Vec2, radius: number): Vec2 => {
  if (onFloor(grid, p, radius)) return p;
  for (let ring = 1; ring <= 40; ring++) {
    const r = ring * 0.5;
    const steps = ring * 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      if (onFloor(grid, q, radius)) return q;
    }
  }
  return p;
};

/** Враги зала: по центру, несколько — по кругу. */
const placeEnemies = (grid: Grid, room: RoomSpec): EnemyPlacement[] => {
  const list = room.enemies ?? [];
  const c = rectCenter(room.rect);
  return list.map((kind, i) => {
    const a = (i / list.length) * Math.PI * 2;
    const off = list.length > 1 ? CELL : 0;
    const p = { x: c.x + Math.cos(a) * off, y: c.y + Math.sin(a) * off };
    return { kind, roomId: room.id, pos: nearestFloor(grid, p, ENEMY_CLEARANCE) };
  });
};

/**
 * Объекты зала (§7): заданные смещения берутся как есть; иначе 1 объект — в центре, 2 — на четвертях
 * длинной стороны. Каждый объект можно стирать с любой стороны.
 */
const placeObjects = (room: RoomSpec): ObjectPlacement[] => {
  const list = room.objects ?? [];
  const c = rectCenter(room.rect);
  const horizontal = room.rect.w >= room.rect.h;
  const quarter = ((horizontal ? room.rect.w : room.rect.h) * CELL) / 4;
  return list.map((o, i) => {
    const base = {
      cls: objectClass(o),
      roomId: room.id,
      key: `${room.id}#${i}`,
      art: typeof o === 'string' ? undefined : o.art,
    };
    if (typeof o !== 'string' && (o.dx !== undefined || o.dy !== undefined)) {
      return { ...base, center: { x: c.x + (o.dx ?? 0) * CELL, y: c.y - (o.dy ?? 0) * CELL } };
    }
    if (list.length === 1) return { ...base, center: c };
    const sign = i === 0 ? -1 : 1;
    return { ...base, center: horizontal ? { x: c.x + sign * quarter, y: c.y } : { x: c.x, y: c.y - sign * quarter } };
  });
};

/** Раскладка → чанк. Невалидная раскладка — ошибка со списком проблем. */
export const buildChunk = (layout: ChunkLayout): ChunkMap => {
  const problems = validateLayout(layout);
  if (problems.length > 0) throw new Error(`Раскладка чанка невалидна:\n- ${problems.join('\n- ')}`);

  const { w, h } = chunkSize(layout);
  const grid = new Grid(w, h);
  const roomFloor = new Uint8Array(w * h);
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));

  // 1. Пол залов по их форме.
  for (const r of layout.rooms) {
    const mask = roomFloorMask(r);
    for (let j = 0; j < r.rect.h; j++) {
      for (let i = 0; i < r.rect.w; i++) {
        if (!mask[j * r.rect.w + i]) continue;
        grid.set(r.rect.x + i, r.rect.y + j, Cell.Empty);
        roomFloor[(r.rect.y + j) * w + r.rect.x + i] = 1;
      }
    }
  }

  // 2. Ходы в зазорах и «докапывание» до пола неровных залов.
  const corridors = corridorGeometries(layout);
  for (const g of corridors) {
    for (const c of g.rects) grid.carveRect(c.x, c.y, c.w, c.h);
    for (const end of g.ends) {
      const room = rooms.get(end.room)!;
      const limit = g.axis === 'horizontal' ? room.rect.w : room.rect.h;
      for (let k = 0; k < limit; k++) {
        const along = end.along + end.dir * k;
        let allFloor = true;
        for (let l = 0; l < g.width; l++) {
          const [cx, cy] = g.axis === 'horizontal' ? [along, end.lateral + l] : [end.lateral + l, along];
          if (!roomFloor[cy * w + cx]) allFloor = false;
        }
        if (allFloor) break;
        for (let l = 0; l < g.width; l++) {
          const [cx, cy] = g.axis === 'horizontal' ? [along, end.lateral + l] : [end.lateral + l, along];
          grid.set(cx, cy, Cell.Empty);
        }
      }
    }
  }

  grid.fillNotches();

  // 3. Острова и колонны.
  for (const r of layout.rooms) {
    for (const isl of r.islands ?? []) grid.fillRect(r.rect.x + isl.x, r.rect.y + isl.y, isl.w, isl.h);
  }
  grid.cutCorners();

  const base = layout.rooms.find((r) => r.kind === 'base') ?? layout.rooms[0];
  return {
    layout,
    grid,
    corridors,
    spawn: rectCenter(base.rect),
    objects: layout.rooms.flatMap(placeObjects),
    enemies: layout.rooms.flatMap((r) => placeEnemies(grid, r)),
    enemyBlocked: layout.rooms.filter((r) => r.kind === 'base').map((r) => r.rect),
  };
};
