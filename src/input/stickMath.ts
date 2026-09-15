import { clamp, type Vec2 } from '../math/vec2';

export interface StickParams {
  radius: number;
  deadZone: number;
}

/**
 * Переводит смещение пальца от центра стика (экранные px, y вниз) в вектор ввода мира
 * (y вверх), длина которого — сила стика 0..1.
 */
export const stickToInput = (dx: number, dy: number, p: StickParams): Vec2 => {
  const len = Math.hypot(dx, dy);
  const dead = p.deadZone * p.radius;
  if (len <= dead || p.radius <= dead) return { x: 0, y: 0 };
  const strength = clamp((len - dead) / (p.radius - dead), 0, 1);
  return { x: (dx / len) * strength, y: (-dy / len) * strength };
};

/** Новый центр стика, если палец ушёл дальше радиуса (режим «следовать за пальцем»). */
export const followOrigin = (origin: Vec2, finger: Vec2, radius: number): Vec2 => {
  const dx = finger.x - origin.x;
  const dy = finger.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len <= radius) return origin;
  const k = (len - radius) / len;
  return { x: origin.x + dx * k, y: origin.y + dy * k };
};
