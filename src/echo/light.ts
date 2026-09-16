import { CELL } from '../core/config';
import { angleDelta, clamp, type Segment, type Vec2 } from '../math/vec2';
import type { WallIndex } from '../world/grid';

export interface LightParams {
  /** Радиус круга света вокруг игрока, ед. */
  radius: number;
  /** Дальность луча вперёд по носу, ед. */
  coneRange: number;
  /** Полная ширина луча, градусы. */
  coneAngleDeg: number;
  /** Ширина мягкого края (доля радиуса / ширины луча). */
  softness: number;
}

/** Как свет выглядит (решение пользователя): тёплый подводный, ореол тусклее прожектора. */
export interface LightLook {
  /** Насколько ореол вокруг существа рассеивает туман (0..1). */
  ambientLevel: number;
  /** Насколько луч-прожектор рассеивает туман (0..1). */
  beamLevel: number;
  /** Цвет света. */
  color: string;
  /** Сила тёплого подсвета от ореола и от прожектора. */
  ambientTint: number;
  beamTint: number;
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Яркость света (0..1) в точке со смещением (dx, dy) от игрока без учёта стен: ореол + луч по носу. */
export const lightStrength = (dx: number, dy: number, heading: number, p: LightParams): number => {
  const d = Math.hypot(dx, dy);
  const circle = 1 - smooth(p.radius * (1 - p.softness), p.radius, d);
  const half = (p.coneAngleDeg * Math.PI) / 360;
  const off = Math.abs(angleDelta(heading, Math.atan2(dy, dx)));
  const across = 1 - smooth(half * (1 - p.softness), half, off);
  const along = 1 - smooth(p.coneRange * (1 - p.softness), p.coneRange, d);
  return Math.max(circle, across * along);
};

/** Дальность, на которую имеет смысл пускать луч видимости в направлении angle. */
export const lightReach = (angle: number, heading: number, p: LightParams): number => {
  const half = (p.coneAngleDeg * Math.PI) / 360;
  return Math.abs(angleDelta(heading, angle)) <= half ? p.coneRange : p.radius;
};

/** Расстояние вдоль луча до пересечения с отрезком или Infinity. */
const rayHit = (ox: number, oy: number, dx: number, dy: number, s: Segment): number => {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const fx = s.ax - ox;
  const fy = s.ay - oy;
  const t = (fx * ey - fy * ex) / den;
  const u = (fx * dy - fy * dx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
};

/**
 * Многоугольник видимости: лучи из origin, отсортированные по углу, с длиной до ближайшей стены
 * (но не дальше досягаемости света). Лучи — равномерные плюс по паре на каждый конец отрезка стены,
 * чтобы тени от углов были точными. Многоугольник звёздный относительно origin.
 */
export interface VisibilityPolygon {
  origin: Vec2;
  angles: Float64Array;
  radii: Float64Array;
}

const scratch: Segment[] = [];

export const castVisibility = (
  origin: Vec2,
  heading: number,
  walls: WallIndex,
  p: LightParams,
  uniformRays = 160,
): VisibilityPolygon => {
  const maxReach = Math.max(p.radius, p.coneRange);
  const segments = walls.near(origin.x, origin.y, maxReach, scratch);
  const angles: number[] = [];
  for (let i = 0; i < uniformRays; i++) angles.push(-Math.PI + (i / uniformRays) * Math.PI * 2);
  // Края луча — чтобы переход круг/луч был ровным.
  const half = (p.coneAngleDeg * Math.PI) / 360;
  angles.push(heading - half, heading + half);
  for (const s of segments) {
    for (const [x, y] of [
      [s.ax, s.ay],
      [s.bx, s.by],
    ]) {
      const dx = x - origin.x;
      const dy = y - origin.y;
      if (Math.hypot(dx, dy) > maxReach + 0.5) continue;
      const a = Math.atan2(dy, dx);
      angles.push(a - 1e-4, a + 1e-4);
    }
  }
  const norm = angles.map((a) => Math.atan2(Math.sin(a), Math.cos(a))).sort((a, b) => a - b);
  const outA = new Float64Array(norm.length);
  const outR = new Float64Array(norm.length);
  norm.forEach((a, i) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = lightReach(a, heading, p);
    for (const s of segments) best = Math.min(best, rayHit(origin.x, origin.y, dx, dy, s));
    outA[i] = a;
    outR[i] = best;
  });
  return { origin, angles: outA, radii: outR };
};

/**
 * Дальность луча до первой стены обходом клеток (Amanatides–Woo): проверяются только стены клеток,
 * через которые проходит луч. Нужен для дальних лучей (эхо), где перебор всех стен слишком дорог.
 * В корзине пустой клетки лежат все отрезки её границ, поэтому первое попадание — ближайшее.
 */
export const marchRay = (walls: WallIndex, ox: number, oy: number, angle: number, reach: number): number => {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Координаты клеток: x вправо, y вниз.
  let cx = Math.floor(ox / CELL);
  let cy = Math.floor(-oy / CELL);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = -dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
  const nextX = (stepX > 0 ? cx + 1 : cx) * CELL;
  const nextY = (stepY > 0 ? cy + 1 : cy) * CELL; // граница клетки по «вниз»-оси
  let tMaxX = dx !== 0 ? (nextX - ox) / dx : Infinity;
  let tMaxY = dy !== 0 ? (nextY - -oy) / -dy : Infinity;
  let tEnter = 0;
  while (tEnter <= reach) {
    let best = Infinity;
    for (const s of walls.inCell(cx, cy)) {
      const t = rayHit(ox, oy, dx, dy, s);
      if (t < best) best = t;
    }
    if (best < Infinity) return Math.min(best, reach);
    if (tMaxX < tMaxY) {
      tEnter = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tEnter = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
    }
    if (cx < -1 || cy < -1 || cx > walls.width || cy > walls.height) return Math.min(tEnter, reach);
  }
  return reach;
};

/** Круговой многоугольник видимости большого радиуса из равномерных лучей, пущенных обходом клеток. */
export const castVisibilityFar = (origin: Vec2, walls: WallIndex, reach: number, rays: number): VisibilityPolygon => {
  const angles = new Float64Array(rays);
  const radii = new Float64Array(rays);
  for (let i = 0; i < rays; i++) {
    const a = -Math.PI + (i / rays) * Math.PI * 2;
    angles[i] = a;
    radii[i] = marchRay(walls, origin.x, origin.y, a, reach);
  }
  return { origin, angles, radii };
};

/** Видна ли точка из центра многоугольника (не заслонена стеной и в пределах досягаемости). */
export const isVisible = (poly: VisibilityPolygon, p: Vec2): boolean => {
  const dx = p.x - poly.origin.x;
  const dy = p.y - poly.origin.y;
  const d = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const { angles, radii } = poly;
  const n = angles.length;
  if (n === 0) return false;
  // Бинарный поиск соседних лучей; радиус между ними — по хорде (многоугольник строится так же).
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (angles[mid] < a) lo = mid + 1;
    else hi = mid;
  }
  const i1 = lo % n;
  const i0 = (lo - 1 + n) % n;
  const a0 = angles[i0];
  const a1 = angles[i1];
  const span = Math.abs(angleDelta(a0, a1)) || 1e-9;
  const t = clamp(Math.abs(angleDelta(a0, a)) / span, 0, 1);
  // Точка на хорде между концами лучей в направлении a.
  const x0 = Math.cos(a0) * radii[i0];
  const y0 = Math.sin(a0) * radii[i0];
  const x1 = Math.cos(a1) * radii[i1];
  const y1 = Math.sin(a1) * radii[i1];
  const cx = x0 + (x1 - x0) * t;
  const cy = y0 + (y1 - y0) * t;
  return d <= Math.hypot(cx, cy) + 1e-6;
};
