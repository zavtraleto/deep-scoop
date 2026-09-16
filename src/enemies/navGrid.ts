import { CELL } from '../core/config';
import { closestPointOnSegment, type Segment, type Vec2 } from '../math/vec2';
import { Cell, Grid, type WallIndex } from '../world/grid';
import type { CellRect } from '../gen/layout';

/**
 * Сетка для врагов (§10.1): копия карты, где запретные зоны (база, §4.7) залиты скалой.
 * Из неё же строятся стены для столкновений врагов — в базу враг не заплывает даже по инерции.
 */
export const enemyGrid = (grid: Grid, blocked: readonly CellRect[]): Grid => {
  const g = new Grid(grid.width, grid.height);
  g.cells.set(grid.cells);
  for (const r of blocked) g.fillRect(r.x, r.y, r.w, r.h);
  return g;
};

const NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export const cellCenter = (cx: number, cy: number): Vec2 => ({ x: (cx + 0.5) * CELL, y: -(cy + 0.5) * CELL });

/**
 * Поиск пути по клеткам — BFS (§10.1), 8 соседей без срезания углов. Проходимы только целиком пустые
 * клетки: центр диагональной лежит на её стене. Если цель недостижима (в скале, в базе, в отрезанной
 * области), путь ведёт к ближайшей к цели достижимой клетке.
 */
export class NavGrid {
  readonly width: number;
  readonly height: number;
  private readonly passable: Uint8Array;
  private readonly prev: Int32Array;
  private readonly seen: Uint32Array;
  private readonly queue: Int32Array;
  private stamp = 0;

  constructor(grid: Grid) {
    this.width = grid.width;
    this.height = grid.height;
    const n = grid.width * grid.height;
    this.passable = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.passable[i] = grid.cells[i] === Cell.Empty ? 1 : 0;
    this.prev = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.queue = new Int32Array(n);
  }

  cellOf(p: Vec2): { cx: number; cy: number } {
    return { cx: Math.floor(p.x / CELL), cy: Math.floor(-p.y / CELL) };
  }

  isPassable(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height && this.passable[cy * this.width + cx] === 1;
  }

  /**
   * Путевые точки от from к target (центры клеток, без стартовой). Если цель достижима и сама на полу,
   * последняя точка — ровно target. reached = false — путь к ближайшей достижимой клетке.
   */
  findPath(from: Vec2, target: Vec2): { points: Vec2[]; reached: boolean } {
    const w = this.width;
    const s = this.cellOf(from);
    const t = this.cellOf(target);
    const start = clampCell(s.cx, w) + clampCell(s.cy, this.height) * w;
    const goal = this.isPassable(t.cx, t.cy) ? t.cy * w + t.cx : -1;

    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.seen[start] = stamp;
    this.prev[start] = -1;
    let best = start;
    let bestD = distToTarget(start, w, target);
    let found = -1;

    while (head < tail) {
      const cur = this.queue[head++];
      if (cur === goal) {
        found = cur;
        break;
      }
      const d = distToTarget(cur, w, target);
      if (d < bestD) {
        bestD = d;
        best = cur;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.isPassable(nx, ny)) continue;
        // Диагональ — только если обе боковые клетки свободны: угол не срезаем.
        if (dx !== 0 && dy !== 0 && (!this.isPassable(cx + dx, cy) || !this.isPassable(cx, cy + dy))) continue;
        const ni = ny * w + nx;
        if (this.seen[ni] === stamp) continue;
        this.seen[ni] = stamp;
        this.prev[ni] = cur;
        this.queue[tail++] = ni;
      }
    }

    const end = found >= 0 ? found : best;
    const cells: number[] = [];
    for (let c = end; c !== -1 && c !== start; c = this.prev[c]) cells.push(c);
    cells.reverse();
    const points = cells.map((c) => cellCenter(c % w, Math.floor(c / w)));
    if (found >= 0) {
      if (points.length > 0) points[points.length - 1] = { ...target };
      else points.push({ ...target });
    }
    return { points, reached: found >= 0 };
  }
}

const clampCell = (v: number, size: number) => Math.min(Math.max(v, 0), size - 1);

const distToTarget = (cell: number, w: number, target: Vec2): number => {
  const c = cellCenter(cell % w, Math.floor(cell / w));
  return (c.x - target.x) ** 2 + (c.y - target.y) ** 2;
};

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const segmentsCross = (p: Segment, q: Segment): boolean => {
  const d1 = cross(q.ax, q.ay, q.bx, q.by, p.ax, p.ay);
  const d2 = cross(q.ax, q.ay, q.bx, q.by, p.bx, p.by);
  const d3 = cross(p.ax, p.ay, p.bx, p.by, q.ax, q.ay);
  const d4 = cross(p.ax, p.ay, p.bx, p.by, q.bx, q.by);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

const pointSegDist2 = (s: Segment, px: number, py: number) => {
  const c = closestPointOnSegment(s, px, py);
  return (c.x - px) ** 2 + (c.y - py) ** 2;
};

const scratch: Segment[] = [];

/**
 * Свободен ли отрезок a→b для круга радиуса r: ни одна стена не ближе r к отрезку.
 * r = 0 — просто прямая видимость.
 */
export const segmentClear = (walls: WallIndex, a: Vec2, b: Vec2, r: number): boolean => {
  const path: Segment = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const near = walls.near((a.x + b.x) / 2, (a.y + b.y) / 2, half + r, scratch);
  const r2 = r * r;
  for (const s of near) {
    if (segmentsCross(path, s)) return false;
    if (r2 === 0) continue;
    if (
      pointSegDist2(s, a.x, a.y) < r2 ||
      pointSegDist2(s, b.x, b.y) < r2 ||
      pointSegDist2(path, s.ax, s.ay) < r2 ||
      pointSegDist2(path, s.bx, s.by) < r2
    ) {
      return false;
    }
  }
  return true;
};
