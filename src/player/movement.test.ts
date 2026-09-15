import { describe, expect, it } from 'vitest';
import { movementConfig } from '../core/config';
import { createMovementState, dragDecel, massFor, stepMovement, type MovementState } from './movement';

// Тесты идут на боевых значениях: если тюнинг сломает ощущение, это будет видно здесь.
const params = { ...movementConfig };
const dt = 1 / 120;

interface Trace {
  minSpeed: number;
  maxX: number;
  maxAbsY: number;
  maxSlipDeg: number;
  sawBraking: boolean;
  sawDrift: boolean;
}

const simulate = (state: MovementState, input: { x: number; y: number }, mass: number, seconds: number, p = params) => {
  const pos = { x: 0, y: 0 };
  const trace: Trace = { minSpeed: Infinity, maxX: 0, maxAbsY: 0, maxSlipDeg: 0, sawBraking: false, sawDrift: false };
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    stepMovement(state, input, mass, p, dt);
    pos.x += state.vel.x * dt;
    pos.y += state.vel.y * dt;
    const speed = Math.hypot(state.vel.x, state.vel.y);
    trace.minSpeed = Math.min(trace.minSpeed, speed);
    trace.maxX = Math.max(trace.maxX, pos.x);
    trace.maxAbsY = Math.max(trace.maxAbsY, Math.abs(pos.y));
    trace.sawBraking ||= state.braking;
    trace.sawDrift ||= state.drift > 0.9;
    if (speed > 1) {
      const slip = Math.atan2(Math.sin(state.heading - Math.atan2(state.vel.y, state.vel.x)), Math.cos(state.heading - Math.atan2(state.vel.y, state.vel.x)));
      trace.maxSlipDeg = Math.max(trace.maxSlipDeg, (Math.abs(slip) * 180) / Math.PI);
    }
  }
  return trace;
};

const cruising = (vx: number): MovementState => {
  const s = createMovementState(vx >= 0 ? 0 : Math.PI);
  s.vel.x = vx;
  return s;
};

describe('разгон и торможение', () => {
  it('без груза разгоняется до максимума примерно за accelTime', () => {
    const s = createMovementState();
    simulate(s, { x: 1, y: 0 }, 1, 0.3);
    expect(s.vel.x).toBeLessThan(6);
    simulate(s, { x: 1, y: 0 }, 1, 0.12);
    expect(s.vel.x).toBeCloseTo(6, 5);
  });

  it('никогда не превышает максимальную скорость', () => {
    const s = createMovementState();
    simulate(s, { x: 1, y: 0.3 }, 1, 3);
    expect(Math.hypot(s.vel.x, s.vel.y)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('после отпускания останавливается примерно за stopTime', () => {
    const s = cruising(6);
    simulate(s, { x: 0, y: 0 }, 1, 0.7);
    expect(s.vel.x).toBeGreaterThan(0);
    simulate(s, { x: 0, y: 0 }, 1, 0.15);
    expect(s.vel.x).toBe(0);
  });

  it('торможение без ввода не зависит от массы', () => {
    const a = cruising(6);
    const b = cruising(6);
    simulate(a, { x: 0, y: 0 }, 1, 0.4);
    simulate(b, { x: 0, y: 0 }, 2, 0.4);
    expect(a.vel.x).toBeCloseTo(b.vel.x, 10);
  });

  it('с полным грузом разгон вдвое медленнее, а максимум тот же', () => {
    expect(massFor(10, 10, 1)).toBe(2);
    const light = createMovementState();
    const heavy = createMovementState();
    simulate(light, { x: 1, y: 0 }, 1, 0.2);
    simulate(heavy, { x: 1, y: 0 }, 2, 0.2);
    expect(heavy.vel.x).toBeLessThan(light.vel.x * 0.75);
    simulate(heavy, { x: 1, y: 0 }, 2, 2);
    expect(heavy.vel.x).toBeCloseTo(6, 5);
  });

  it('полстика — полскорости в режиме analogSpeedCap', () => {
    const s = createMovementState();
    simulate(s, { x: 0.5, y: 0 }, 1, 3);
    expect(s.vel.x).toBeCloseTo(3, 5);
  });

  it('drag на максимальной скорости подобран под stopTime', () => {
    expect(dragDecel(6, { ...params, dragViscousShare: 0 })).toBeCloseTo(7.5, 5);
  });
});

describe('задний сектор — тормоз', () => {
  it('разворот на 180° тормозит, а не уводит в дугу', () => {
    const s = cruising(6);
    const trace = simulate(s, { x: -1, y: 0 }, 1, 2);
    expect(trace.sawBraking).toBe(true);
    expect(trace.minSpeed).toBeLessThan(1.5);
    expect(trace.maxX).toBeLessThan(1.2); // короткий тормозной путь
    expect(trace.maxAbsY).toBeLessThan(0.3); // без дуги
    expect(s.vel.x).toBeCloseTo(-6, 1);
  });

  it('с грузом тормозной путь длиннее', () => {
    const light = simulate(cruising(6), { x: -1, y: 0 }, 1, 2);
    const heavy = simulate(cruising(6), { x: -1, y: 0 }, 2, 3);
    expect(heavy.maxX).toBeGreaterThan(light.maxX * 1.3);
  });

  it('с места в обратную сторону — разворот на месте без подскока', () => {
    const s = createMovementState(0);
    const trace = simulate(s, { x: -1, y: 0 }, 1, 1);
    expect(trace.maxAbsY).toBeLessThan(0.05);
    expect(s.vel.x).toBeLessThan(-5);
  });

  it('разворот тяжёлый: назад на 90% скорости не быстрее ~0.75 с', () => {
    const s = cruising(6);
    let t90 = -1;
    for (let t = 0; t < 3 && t90 < 0; t += dt) {
      stepMovement(s, { x: -1, y: 0 }, 1, params, dt);
      if (s.vel.x < -5.4) t90 = t;
    }
    expect(t90).toBeGreaterThan(0.75);
    expect(t90).toBeLessThan(1.3);
  });

  it('нос с инерцией не проскакивает цель', () => {
    const s = createMovementState(0);
    let maxHeading = 0;
    for (let t = 0; t < 2; t += dt) {
      stepMovement(s, { x: -1, y: 0 }, 1, params, dt);
      maxHeading = Math.max(maxHeading, s.heading);
    }
    expect(maxHeading).toBeLessThan(Math.PI * 1.05);
    expect(s.heading).toBeCloseTo(Math.PI, 2);
  });

  it('поворот на 90° — не тормоз', () => {
    expect(simulate(cruising(6), { x: 0, y: 1 }, 1, 1).sawBraking).toBe(false);
  });

  it('задний сектор считается от носа, а не от скорости', () => {
    // Летим вправо, но нос уже смотрит вверх (занос). Стик вниз — прямо позади носа → тормоз.
    const s = cruising(6);
    s.heading = Math.PI / 2;
    stepMovement(s, { x: 0, y: -1 }, 1, params, dt);
    expect(s.braking).toBe(true);
    // Стик влево — сбоку от носа → поворот, хотя против скорости.
    const t = cruising(6);
    t.heading = Math.PI / 2;
    stepMovement(t, { x: -1, y: 0 }, 1, params, dt);
    expect(t.braking).toBe(false);
  });
});

describe('занос', () => {
  it('резкий поворот на полной скорости срывает корму', () => {
    const trace = simulate(cruising(6), { x: 0, y: 1 }, 1, 1.5);
    expect(trace.sawDrift).toBe(true);
    expect(trace.maxSlipDeg).toBeGreaterThan(45); // нос сильно разошёлся со скоростью
    expect(trace.maxX).toBeGreaterThan(1.2); // проносит по старой траектории
    expect(trace.maxX).toBeLessThan(3);
  });

  it('на малой скорости поворот точный, без заноса', () => {
    const trace = simulate(cruising(2.5), { x: 0, y: 1 }, 1, 1.5);
    expect(trace.sawDrift).toBe(false);
    expect(trace.maxX).toBeLessThan(0.9); // немного проносит — инерция вращения, «вес»
  });

  it('с грузом занос шире', () => {
    const light = simulate(cruising(6), { x: 0, y: 1 }, 1, 2);
    const heavy = simulate(cruising(6), { x: 0, y: 1 }, 2, 2);
    expect(heavy.maxX).toBeGreaterThan(light.maxX * 1.5);
  });

  it('после заноса нос возвращается к стику', () => {
    const s = cruising(6);
    simulate(s, { x: 0, y: 1 }, 1, 2);
    expect(s.heading).toBeCloseTo(Math.PI / 2, 2);
    expect(s.vel.y).toBeCloseTo(6, 1);
  });
});
