import type { ObjectClass } from '../collect/memoryObject';
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
}

/** Готовый чанк: сетка клеток и всё, что нужно расставить в мире (координаты мира). */
export interface ChunkMap {
  layout: ChunkLayout;
  grid: Grid;
  corridors: CorridorGeometry[];
  spawn: Vec2;
  objects: ObjectPlacement[];
  shards: Vec2[];
}

const SHARD_SPACING = 0.9; // ед. между осколками в кластере
const SHARD_EDGE_INSET = 1.2; // ед. от края габарита при кластере вдоль края зала

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

/** Сдвигать точку к цели, пока она не встанет на пол (кривой край пещеры, острова). */
const snapToFloor = (grid: Grid, p: Vec2, toward: Vec2, radius: number): Vec2 => {
  const dx = toward.x - p.x;
  const dy = toward.y - p.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / 0.25);
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const q = { x: p.x + dx * t, y: p.y + dy * t };
    if (onFloor(grid, q, radius)) return q;
  }
  return p;
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
    if (typeof o !== 'string') return { cls: o.cls, roomId: room.id, center: { x: c.x + o.dx * CELL, y: c.y - o.dy * CELL } };
    if (list.length === 1) return { cls: o, roomId: room.id, center: c };
    const sign = i === 0 ? -1 : 1;
    return {
      cls: objectClass(o),
      roomId: room.id,
      center: horizontal ? { x: c.x + sign * quarter, y: c.y } : { x: c.x, y: c.y - sign * quarter },
    };
  });
};

/** Точки вдоль отрезка from→to, по центру, с шагом не больше SHARD_SPACING и лёгким зигзагом поперёк. */
const lineCluster = (from: Vec2, to: Vec2, count: number, zigzag: number): Vec2[] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.min(SHARD_SPACING, len / (count + 1));
  const nx = -dy / (len || 1);
  const ny = dx / (len || 1);
  const start = len / 2 - (step * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => {
    const t = (start + step * i) / (len || 1);
    const z = (i % 2 === 0 ? 1 : -1) * zigzag;
    return { x: from.x + dx * t + nx * z, y: from.y + dy * t + ny * z };
  });
};

const placeShards = (layout: ChunkLayout, grid: Grid, corridors: CorridorGeometry[], rooms: Map<string, RoomSpec>): Vec2[] => {
  const out: Vec2[] = [];
  for (const cluster of layout.shards) {
    if ('corridor' in cluster.at) {
      const g = corridors[cluster.at.corridor];
      if (!g) throw new Error(`Кластер осколков: нет хода №${cluster.at.corridor}`);
      // Кластер — вдоль самого длинного отрезка хода.
      const r = g.rects.reduce((best, cur) =>
        (g.axis === 'horizontal' ? cur.w > best.w : cur.h > best.h) ? cur : best,
      );
      const c = rectCenter(r);
      const half = ((g.axis === 'horizontal' ? r.w : r.h) * CELL) / 2;
      const from = g.axis === 'horizontal' ? { x: c.x - half, y: c.y } : { x: c.x, y: c.y + half };
      const to = g.axis === 'horizontal' ? { x: c.x + half, y: c.y } : { x: c.x, y: c.y - half };
      out.push(...lineCluster(from, to, cluster.count, 0.25));
      continue;
    }
    const room = rooms.get(cluster.at.room);
    if (!room) throw new Error(`Кластер осколков: нет зала ${cluster.at.room}`);
    const { x, y, w, h } = room.rect;
    const left = x * CELL + SHARD_EDGE_INSET;
    const right = (x + w) * CELL - SHARD_EDGE_INSET;
    const top = -y * CELL - SHARD_EDGE_INSET;
    const bottom = -(y + h) * CELL + SHARD_EDGE_INSET;
    const edge = {
      top: [{ x: left, y: top }, { x: right, y: top }],
      bottom: [{ x: left, y: bottom }, { x: right, y: bottom }],
      left: [{ x: left, y: top }, { x: left, y: bottom }],
      right: [{ x: right, y: top }, { x: right, y: bottom }],
    }[cluster.at.edge];
    // У неровного зала край габарита может быть в скале: сдвигаем осколки к центру до пола.
    const center = rectCenter(room.rect);
    out.push(...lineCluster(edge[0], edge[1], cluster.count, 0).map((p) => snapToFloor(grid, p, center, 0.3)));
  }
  return out;
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
    shards: placeShards(layout, grid, corridors, rooms),
  };
};
