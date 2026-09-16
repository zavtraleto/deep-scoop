import { describe, expect, it } from 'vitest';
import { stepCollect, type Cargo } from './collector';
import { convexHull, EraseMask } from './eraseMask';
import { objectValue } from './memoryObject';
import { createScoopState, scoopShape, scoopTargetAngle } from './scoop';
import { solidObject, testScoop } from './testHelpers';

const scoopParams = testScoop;

const fullMask = (w: number, h: number) => new EraseMask(w, h, new Uint8Array(w * h).fill(1));

describe('EraseMask', () => {
  it('закрашивает прямоугольник ровно по центрам пикселей', () => {
    const m = fullMask(10, 10);
    const n = m.fillConvex([
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 5 },
      { x: 2, y: 5 },
    ]);
    expect(n).toBe(4 * 3);
    expect(m.progress).toBeCloseTo(0.12);
  });

  it('не считает повторно уже стёртые и прозрачные пиксели', () => {
    const opaque = new Uint8Array(100);
    opaque.fill(1, 0, 50); // нижняя половина непрозрачна
    const m = new EraseMask(10, 10, opaque);
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(m.fillConvex(square)).toBe(50);
    expect(m.fillConvex(square)).toBe(0);
    expect(m.progress).toBe(1);
  });

  it('выпуклая оболочка «бантика» из двух положений края — четырёхугольник без самопересечения', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
    ]);
    expect(hull).toHaveLength(4);
  });
});

describe('ковш', () => {
  it('по умолчанию смотрит по скорости, а на месте — по носу', () => {
    expect(scoopTargetAngle({ x: 0, y: 5 }, 0, scoopParams)).toBeCloseTo(Math.PI / 2);
    expect(scoopTargetAngle({ x: 0, y: 0 }, 1.2, scoopParams)).toBeCloseTo(1.2);
    expect(scoopTargetAngle({ x: 0, y: 5 }, 0, { ...scoopParams, followNose: true })).toBe(0);
  });

  it('передний край перпендикулярен направлению и шириной с ковш', () => {
    const s = scoopShape({ x: 0, y: 0 }, 0, scoopParams);
    expect(s.frontA.x).toBeCloseTo(0.9);
    expect(s.frontB.x).toBeCloseTo(0.9);
    expect(Math.abs(s.frontA.y - s.frontB.y)).toBeCloseTo(1.2);
  });
});

describe('сбор', () => {
  const pass = (speed: number, stepDt: number) => {
    const obj = solidObject();
    const scoop = createScoopState(0);
    const cargo: Cargo = { cargo: 0, cargoMax: 100 };
    const pos = { x: -6, y: 0 };
    let noisy = 0;
    // Проход слева направо через весь объект по горизонтали.
    while (pos.x < 6) {
      pos.x += speed * stepDt;
      if (stepCollect(scoop, pos, { x: speed, y: 0 }, 0, [obj], cargo, scoopParams, stepDt).noise) noisy++;
    }
    return { obj, cargo, noisy };
  };

  it('проход стирает сплошную полосу шириной с ковш', () => {
    const { obj } = pass(6, 1 / 120);
    // Полоса 1.2 ед. поперёк объекта 7 ед.: доля ≈ 1.2 / 7.
    expect(obj.progress).toBeCloseTo(1.2 / 7, 2);
  });

  it('на огромной скорости с крупным шагом полоса без разрывов', () => {
    const slow = pass(6, 1 / 120).obj.progress;
    const fast = pass(60, 1 / 30).obj.progress; // 2 ед. за шаг — больше глубины ковша
    expect(fast).toBeCloseTo(slow, 2);
  });

  it('груз растёт на Δprogress · value и шумит, пока стирает', () => {
    const { obj, cargo, noisy } = pass(6, 1 / 120);
    expect(cargo.cargo).toBeCloseTo(obj.progress * 6, 5);
    expect(noisy).toBeGreaterThan(0);
  });

  it('при полном грузе стирает дальше, но груз не растёт (§11)', () => {
    const obj = solidObject();
    const scoop = createScoopState(0);
    const cargo: Cargo = { cargo: 9.99, cargoMax: 10 };
    const res = stepCollect(scoop, { x: 0, y: 0 }, { x: 1, y: 0 }, 0, [obj], cargo, scoopParams, 1 / 120);
    expect(res.noise).toBe(true);
    expect(cargo.cargo).toBe(10);
  });

  it('вне объекта тихо', () => {
    const obj = solidObject();
    const scoop = createScoopState(0);
    const cargo: Cargo = { cargo: 0, cargoMax: 10 };
    const res = stepCollect(scoop, { x: 20, y: 20 }, { x: 1, y: 0 }, 0, [obj], cargo, scoopParams, 1 / 120);
    expect(res.noise).toBe(false);
    expect(cargo.cargo).toBe(0);
  });

  it('ценность растёт с глубиной (§7)', () => {
    expect(objectValue(6, 0)).toBe(6);
    expect(objectValue(6, 4)).toBe(12);
  });
});
