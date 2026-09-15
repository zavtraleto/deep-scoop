export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const length = (v: Vec2): number => Math.hypot(v.x, v.y);

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/** Коэффициент экспоненциального сглаживания, не зависящий от частоты кадров. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Кратчайшая разница углов в диапазоне (-PI, PI]. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Ближайшая к точке (px, py) точка отрезка. */
export const closestPointOnSegment = (s: Segment, px: number, py: number): Vec2 => {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - s.ax) * dx + (py - s.ay) * dy) / len2, 0, 1);
  return { x: s.ax + dx * t, y: s.ay + dy * t };
};
