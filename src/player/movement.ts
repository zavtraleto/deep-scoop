import { angleDelta, clamp, length, type Vec2 } from '../math/vec2';

export interface MovementParams {
  maxSpeed: number;
  accelTime: number;
  stopTime: number;
  dragViscousShare: number;
  analogSpeedCap: boolean;
  baseMass: number;

  /** Доворот носа к стику на полной скорости без груза, рад/с. */
  steerRate: number;
  /** Во сколько раз доворот быстрее на месте (1 + boost при нулевой скорости). */
  steerLowSpeedBoost: number;
  /** Инерция вращения: время раскрутки носа до максимальной угловой скорости без груза, с. */
  steerSpinUpTime: number;
  /** Мягкость подхода носа к цели: угловая скорость = угол до цели / settleTime, с. */
  steerSettleTime: number;
  /** Тяга по носу умножается на cos(угол нос→стик)^power: разворачиваясь, нос не толкает не туда. */
  thrustAlignmentPower: number;

  /** Ширина заднего сектора стика, градусы. Стик в нём (относительно скорости) — торможение. */
  rearSectorDeg: number;
  /** Время торможения с максимальной скорости до нуля без груза, с. */
  brakeTime: number;
  /** Ниже этой скорости задний сектор не тормозит, а разворачивает на месте, ед./с. */
  brakeMinSpeed: number;

  /** Сцепление: множитель drag для скольжения вбок относительно носа. */
  grip: number;
  /** Сцепление в полном заносе, доля от grip. */
  driftGrip: number;
  /** Занос начинается с этой доли максимальной скорости и полный на максимуме. */
  driftSpeedStart: number;
  /** Резкость поворота (угол скорость→стик), с которой начинается срыв, градусы; полный срыв на 90°. */
  driftTurnStartDeg: number;
  /** Насколько нос в заносе перекручивается внутрь поворота (корма уходит наружу), градусы. */
  driftOverrotateDeg: number;

  /** Доворот носа к направлению скорости без ввода, 1/с. */
  coastAlignRate: number;
  /** Насколько груз ослабляет доворот и сцепление: делитель massFactor^k. */
  cargoHandlingExponent: number;
}

export interface MovementState {
  vel: Vec2;
  /** Направление носа (рад). Спрайт смотрит сюда; в заносе скорость отстаёт от носа. */
  heading: number;
  /** Угловая скорость носа, рад/с. Даёт повороту инерцию. */
  turnVel: number;
  /** Сила заноса 0..1 на последнем шаге — для отладки и будущих эффектов. */
  drift: number;
  /** Идёт торможение задним сектором. */
  braking: boolean;
}

export const createMovementState = (heading = 0): MovementState => ({
  vel: { x: 0, y: 0 },
  heading,
  turnVel: 0,
  drift: 0,
  braking: false,
});

const DEG = Math.PI / 180;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Замедление (ед./с²) при скорости speed.
 * drag = c + k·v, подобран так, что с maxSpeed игрок останавливается ровно за stopTime.
 * share — доля вязкой части k·v на максимальной скорости.
 */
export const dragDecel = (speed: number, p: MovementParams): number => {
  const s = clamp(p.dragViscousShare, 0, 0.95);
  const D = s < 1e-4 ? p.maxSpeed / p.stopTime : (p.maxSpeed * Math.log(1 / (1 - s))) / (s * p.stopTime);
  const k = (s * D) / p.maxSpeed;
  const c = (1 - s) * D;
  return c + k * speed;
};

/** §5.3: mass = baseMass * (1 + cargo / cargoMax). */
export const massFor = (cargo: number, cargoMax: number, baseMass: number): number =>
  baseMass * (1 + (cargoMax > 0 ? cargo / cargoMax : 0));

/** Тяга подобрана так, что без груза разгон до максимума занимает accelTime. */
export const thrustFor = (p: MovementParams): number => (p.baseMass * p.maxSpeed) / p.accelTime;

/**
 * Круг стика делится относительно носа: задний сектор шириной rearSectorDeg прямо позади носа — тормоз,
 * остальное — зона поворота, нос смотрит в её середину.
 */
export const isRearSector = (heading: number, inputAngle: number, p: MovementParams): boolean =>
  Math.abs(angleDelta(heading, inputAngle)) > Math.PI - (p.rearSectorDeg * DEG) / 2;

/**
 * Поворот носа с инерцией: желаемая угловая скорость пропорциональна углу до цели (мягкий подход)
 * и ограничена maxRate, а фактическая угловая скорость меняется не быстрее angularAccel.
 * Желаемая скорость не больше √(2·α·угол) — нос успевает затормозить и не проскакивает цель.
 */
const turnNose = (state: MovementState, delta: number, maxRate: number, angularAccel: number, settle: number, dt: number) => {
  const brakingLimit = Math.sqrt(2 * angularAccel * Math.abs(delta));
  const limit = Math.min(maxRate, brakingLimit);
  const desired = clamp(delta / Math.max(settle, 1e-3), -limit, limit);
  const dv = desired - state.turnVel;
  state.turnVel += clamp(dv, -angularAccel * dt, angularAccel * dt);
  state.heading += state.turnVel * dt;
};

/** Уменьшить модуль вектора на amount, не переходя через ноль. */
const shrink = (v: Vec2, amount: number): void => {
  const len = length(v);
  if (len <= amount || len === 0) {
    v.x = 0;
    v.y = 0;
    return;
  }
  const k = (len - amount) / len;
  v.x *= k;
  v.y *= k;
};

/**
 * Один шаг физики движения. input — вектор ввода, длина 0..1. Меняет state на месте.
 *
 * Модель «заднеприводной машины»:
 * - стик в заднем секторе относительно носа — торможение, на малой скорости — разворот на месте;
 * - остальные направления — поворот: нос доворачивает к стику, тяга идёт по носу;
 * - на большой скорости при резком повороте сцепление срывается: корма уходит наружу
 *   (нос перекручивается внутрь поворота), тело скользит по старой траектории, потом сцепление ловит.
 * Груз утяжеляет разгон и торможение (§5.3), замедляет доворот и ослабляет сцепление.
 * Торможение без ввода от массы не зависит.
 */
export const stepMovement = (
  state: MovementState,
  input: Vec2,
  mass: number,
  p: MovementParams,
  dt: number,
): void => {
  const v = state.vel;
  const strength = Math.min(length(input), 1);
  const massFactor = mass / p.baseMass;
  const handling = Math.pow(massFactor, p.cargoHandlingExponent);
  const speedBefore = length(v);
  const speedRatio = Math.min(speedBefore / p.maxSpeed, 1);

  state.drift = 0;
  state.braking = false;

  // Предел угловой скорости и углового ускорения носа. Груз делает поворот ленивее.
  const maxTurnRate = (p.steerRate * (1 + p.steerLowSpeedBoost * (1 - speedRatio))) / handling;
  const angularAccel = p.steerRate / Math.max(p.steerSpinUpTime, 1e-3) / handling;

  if (strength === 0) {
    shrink(v, dragDecel(speedBefore, p) * dt);
    const toVelocity = length(v) > 0.3 ? angleDelta(state.heading, Math.atan2(v.y, v.x)) : 0;
    turnNose(state, toVelocity, p.coastAlignRate * Math.abs(toVelocity), angularAccel, p.steerSettleTime, dt);
    return;
  }

  const target = Math.atan2(input.y, input.x);
  const velAngle = Math.atan2(v.y, v.x);
  const turnAngle = Math.abs(angleDelta(velAngle, target)); // насколько резко меняется направление движения

  // Задний сектор (относительно носа) — тормоз. Нос не трогаем: существо тормозит «лицом вперёд», как машина.
  if (speedBefore > p.brakeMinSpeed && isRearSector(state.heading, target, p)) {
    state.braking = true;
    const brake = (p.maxSpeed / p.brakeTime / massFactor) * strength + dragDecel(speedBefore, p);
    shrink(v, brake * dt);
    turnNose(state, 0, maxTurnRate, angularAccel, p.steerSettleTime, dt); // гасим остаток вращения
    return;
  }

  // Срыв сцепления: большая скорость и резкий поворот.
  const drift =
    smoothstep(p.driftSpeedStart, 1, speedRatio) * smoothstep(p.driftTurnStartDeg * DEG, Math.PI / 2, turnAngle);
  // Поддержание заноса: пока нос сильно расходится со скоростью, корма ещё не поймала сцепление.
  const slip = speedBefore > 0.1 ? Math.abs(angleDelta(state.heading, velAngle)) : 0;
  const sustain = smoothstep(p.driftSpeedStart, 1, speedRatio) * smoothstep(10 * DEG, 45 * DEG, slip);
  state.drift = Math.max(drift, sustain * 0.8);

  // Нос доворачивает к стику; в заносе — с перекрутом внутрь поворота.
  const turnSign = Math.sign(angleDelta(velAngle, target)) || 1;
  const noseTarget = target + turnSign * p.driftOverrotateDeg * DEG * state.drift;
  turnNose(state, angleDelta(state.heading, noseTarget), maxTurnRate, angularAccel, p.steerSettleTime, dt);

  const hx = Math.cos(state.heading);
  const hy = Math.sin(state.heading);

  // Тяга слабеет, пока нос не смотрит на стик. На скорости она идёт по носу (занос), а на месте — к стику:
  // иначе медленно разворачивающийся нос подбрасывает существо вбок дугой.
  const noseToStick = Math.abs(angleDelta(state.heading, target));
  const alignment = Math.pow(Math.max(0, Math.cos(noseToStick)), p.thrustAlignmentPower);
  const accel = (thrustFor(p) / mass) * strength * alignment;
  const ux = Math.cos(target);
  const uy = Math.sin(target);
  v.x += (ux + (hx - ux) * speedRatio) * accel * dt;
  v.y += (uy + (hy - uy) * speedRatio) * accel * dt;

  // Скольжение вбок гасится сцеплением; в заносе сцепление слабое. Ось сцепления, как и тяга,
  // на скорости — нос, на месте — стик: разворачивающийся нос не должен уводить существо в сторону.
  const grip = (p.grip * (1 - state.drift * (1 - p.driftGrip))) / handling;
  let gx = ux + (hx - ux) * speedRatio;
  let gy = uy + (hy - uy) * speedRatio;
  const gl = Math.hypot(gx, gy);
  if (gl < 1e-3) {
    gx = hx;
    gy = hy;
  } else {
    gx /= gl;
    gy /= gl;
  }
  const par = v.x * gx + v.y * gy;
  const perp = { x: v.x - gx * par, y: v.y - gy * par };
  shrink(perp, dragDecel(length(perp), p) * grip * dt);
  v.x = gx * par + perp.x;
  v.y = gy * par + perp.y;

  // Ограничение скорости. Если уже быстрее лимита (стик отпустили наполовину) — плавно тормозим до него.
  const cap = p.analogSpeedCap ? p.maxSpeed * strength : p.maxSpeed;
  const limit = speedBefore <= cap ? cap : Math.max(cap, speedBefore - dragDecel(speedBefore, p) * dt);
  const speed = length(v);
  if (speed > limit) {
    v.x *= limit / speed;
    v.y *= limit / speed;
  }
};
