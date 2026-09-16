import { angleDelta, type Vec2 } from '../math/vec2';
import { resolveCircleVsWalls } from '../world/collision';
import type { WallIndex } from '../world/grid';
import type { MemoryObject } from './memoryObject';

export interface FloatParams {
  /** Вязкость среды для движения, 1/с. */
  linearDrag: number;
  /** Вязкость среды для вращения, 1/с. */
  angularDrag: number;
  /** Радиус медленного дрейфа вокруг дома, ед. */
  hoverRadius: number;
  /** Темп дрейфа, рад/с (частота «блуждания»). */
  hoverSpeed: number;
  /** Жёсткость пружины к точке дрейфа, 1/с². */
  hoverSpring: number;
  /** Амплитуда покачивания, градусы. */
  hoverWobbleDeg: number;
  /** Жёсткость пружины покачивания, 1/с². */
  wobbleSpring: number;
  /** Ниже этой скорости разлетевшийся кусок «оседает» и заводит новый дом, ед./с. */
  settleSpeed: number;
  /** Упругость отскока от стен (0 — скольжение). */
  wallRestitution: number;
  /** Радиус столкновений как доля радиуса круга равной площади. */
  collisionRadiusScale: number;
  /** Жёсткость мягкого расталкивания кусков, 1/с². */
  separation: number;
  /** Толчок ковша: скорость игрока × стёртая площадь / масса × nudge. */
  nudge: number;
  /** Толчок не разгоняет объект быстрее этой доли скорости игрока. */
  nudgeMaxSpeedFrac: number;
  /** Доля толчка, уходящая во вращение. */
  nudgeTorque: number;
}

/** Смещение блуждания: сумма двух синусоид по каждой оси, у каждого объекта свои фазы. */
const hoverOffset = (obj: MemoryObject, t: number, p: FloatParams): Vec2 => {
  const [a, b, c, d] = obj.body.phase;
  const w = p.hoverSpeed;
  return {
    x: ((Math.sin(t * w + a) + 0.5 * Math.sin(t * w * 1.73 + b)) / 1.5) * p.hoverRadius,
    y: ((Math.sin(t * w * 0.87 + c) + 0.5 * Math.sin(t * w * 1.41 + d)) / 1.5) * p.hoverRadius,
  };
};

const wobble = (obj: MemoryObject, t: number, p: FloatParams): number =>
  Math.sin(t * p.hoverSpeed * 0.9 + obj.body.phase[0] * 1.3) * ((p.hoverWobbleDeg * Math.PI) / 180);

/** Масса пропорциональна оставшейся площади картинки. */
export const massOf = (obj: MemoryObject): number => Math.max(0.2, obj.area);

export const collisionRadius = (obj: MemoryObject, p: FloatParams): number =>
  Math.sqrt(Math.max(obj.area, 0.05) / Math.PI) * p.collisionRadiusScale;

/**
 * Толчок ковша (решение пользователя: лёгкий, лёгкие куски сильнее, тяжёлые едва).
 * contact — точка касания ковша, playerVel — скорость игрока, erasedArea — стёртая за шаг площадь.
 */
export const applyNudge = (obj: MemoryObject, contact: Vec2, playerVel: Vec2, erasedArea: number, p: FloatParams): void => {
  const b = obj.body;
  const k = (p.nudge * erasedArea) / massOf(obj);
  const dvx = playerVel.x * k;
  const dvy = playerVel.y * k;
  b.vel.x += dvx;
  b.vel.y += dvy;
  const max = Math.hypot(playerVel.x, playerVel.y) * p.nudgeMaxSpeedFrac;
  const speed = Math.hypot(b.vel.x, b.vel.y);
  if (speed > max && speed > 0) {
    b.vel.x *= max / speed;
    b.vel.y *= max / speed;
  }
  const rx = contact.x - b.pos.x;
  const ry = contact.y - b.pos.y;
  const r = Math.max(Math.sqrt(obj.area / Math.PI), 0.3);
  b.angVel += ((rx * dvy - ry * dvx) / (r * r)) * p.nudgeTorque;
};

/**
 * Шаг физики парящих объектов: вязкость, дрейф у дома (или свободный разлёт с оседанием),
 * покачивание, мягкие отскоки от стен и расталкивание друг друга.
 */
export const stepFloat = (objects: readonly MemoryObject[], walls: WallIndex | null, p: FloatParams, dt: number): void => {
  const linDamp = Math.exp(-p.linearDrag * dt);
  const angDamp = Math.exp(-p.angularDrag * dt);

  for (const obj of objects) {
    const b = obj.body;
    b.prevPos.x = b.pos.x;
    b.prevPos.y = b.pos.y;
    b.prevAngle = b.angle;
    if (b.age === 0 && !b.drifting) {
      // Дом ставим так, чтобы точка дрейфа стартовала ровно из текущего положения — без рывка.
      const off = hoverOffset(obj, 0, p);
      b.home = { x: b.pos.x - off.x, y: b.pos.y - off.y };
      b.homeAngle = b.angle - wobble(obj, 0, p);
    }
    b.age += dt;

    if (b.drifting) {
      // Разлёт: только вязкость. Осев, кусок заводит дом там, где остановился, — без рывка.
      if (b.age > 0.5 && Math.hypot(b.vel.x, b.vel.y) < p.settleSpeed) {
        const off = hoverOffset(obj, b.age, p);
        b.home = { x: b.pos.x - off.x, y: b.pos.y - off.y };
        b.homeAngle = b.angle - wobble(obj, b.age, p);
        b.drifting = false;
      }
    } else {
      const off = hoverOffset(obj, b.age, p);
      b.vel.x += (b.home.x + off.x - b.pos.x) * p.hoverSpring * dt;
      b.vel.y += (b.home.y + off.y - b.pos.y) * p.hoverSpring * dt;
      const targetAngle = b.homeAngle + wobble(obj, b.age, p);
      b.angVel += angleDelta(b.angle, targetAngle) * p.wobbleSpring * dt;
    }

    b.vel.x *= linDamp;
    b.vel.y *= linDamp;
    b.angVel *= angDamp;
  }

  // Мягкое расталкивание: сила пропорциональна перекрытию, лёгкие отходят сильнее.
  for (let i = 0; i < objects.length; i++) {
    const a = objects[i];
    const ra = collisionRadius(a, p);
    for (let j = i + 1; j < objects.length; j++) {
      const c = objects[j];
      const dx = c.body.pos.x - a.body.pos.x;
      const dy = c.body.pos.y - a.body.pos.y;
      const dist = Math.hypot(dx, dy);
      const overlap = ra + collisionRadius(c, p) - dist;
      if (overlap <= 0) continue;
      const nx = dist > 1e-6 ? dx / dist : 1;
      const ny = dist > 1e-6 ? dy / dist : 0;
      const ma = massOf(a);
      const mc = massOf(c);
      const push = overlap * p.separation * dt;
      a.body.vel.x -= nx * push * (mc / (ma + mc));
      a.body.vel.y -= ny * push * (mc / (ma + mc));
      c.body.vel.x += nx * push * (ma / (ma + mc));
      c.body.vel.y += ny * push * (ma / (ma + mc));
    }
  }

  for (const obj of objects) {
    const b = obj.body;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.angle += b.angVel * dt;
    if (walls && resolveCircleVsWalls(b.pos, b.vel, collisionRadius(obj, p), walls, p.wallRestitution) && !b.drifting) {
      // Парящий объект, упёршийся в стену, переносит дом, чтобы не давить в неё бесконечно.
      const off = hoverOffset(obj, b.age, p);
      b.home.x += (b.pos.x - off.x - b.home.x) * 0.1;
      b.home.y += (b.pos.y - off.y - b.home.y) * 0.1;
    }
  }
};
