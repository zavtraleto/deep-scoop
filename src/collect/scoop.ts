import { angleDelta, clamp, type Vec2 } from '../math/vec2';

export interface ScoopParams {
  /** Ширина поперёк движения, ед. (§6.1, Приложение A: 1.2). */
  width: number;
  /** Глубина вдоль движения, ед. (Приложение A: 0.6). */
  depth: number;
  /** Расстояние от центра игрока до заднего края ковша, ед. */
  offset: number;
  /** true — ковш смотрит по носу; false — по направлению скорости (решение этапа 2). */
  followNose: boolean;
  /** Ниже этой скорости ковш плавно переходит на направление носа (скорость шумит), ед./с. */
  noseBlendSpeed: number;
  /** Сглаживание поворота ковша, 1/с. */
  turnRate: number;
}

export interface ScoopState {
  angle: number;
  /** Передний край на прошлом шаге: концы a, b. null — ещё не было шага. */
  prevFrontA: Vec2 | null;
  prevFrontB: Vec2 | null;
}

export interface ScoopShape {
  /** Прямоугольник ковша: задний-левый, задний-правый, передний-правый, передний-левый. */
  rect: [Vec2, Vec2, Vec2, Vec2];
  frontA: Vec2;
  frontB: Vec2;
}

export const createScoopState = (angle = 0): ScoopState => ({ angle, prevFrontA: null, prevFrontB: null });

/** Целевое направление ковша: по скорости, а на малой скорости — плавно по носу. */
export const scoopTargetAngle = (vel: Vec2, heading: number, p: ScoopParams): number => {
  if (p.followNose) return heading;
  const speed = Math.hypot(vel.x, vel.y);
  if (speed < 1e-4) return heading;
  const velAngle = Math.atan2(vel.y, vel.x);
  const t = clamp(speed / Math.max(p.noseBlendSpeed, 1e-4), 0, 1);
  const k = t * t * (3 - 2 * t);
  return heading + angleDelta(heading, velAngle) * k;
};

/** Повернуть ковш к цели со сглаживанием. */
export const updateScoopAngle = (state: ScoopState, target: number, p: ScoopParams, dt: number): void => {
  state.angle += angleDelta(state.angle, target) * (1 - Math.exp(-p.turnRate * dt));
};

export const scoopShape = (pos: Vec2, angle: number, p: ScoopParams): ScoopShape => {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy * (p.width / 2);
  const ny = dx * (p.width / 2);
  const bx = pos.x + dx * p.offset;
  const by = pos.y + dy * p.offset;
  const fx = bx + dx * p.depth;
  const fy = by + dy * p.depth;
  const frontA = { x: fx + nx, y: fy + ny };
  const frontB = { x: fx - nx, y: fy - ny };
  return {
    rect: [{ x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }, frontB, frontA],
    frontA,
    frontB,
  };
};
