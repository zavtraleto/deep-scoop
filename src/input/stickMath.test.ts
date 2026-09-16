import { describe, expect, it } from 'vitest';
import { cursorToInput, followOrigin, stickToInput } from './stickMath';

const p = { radius: 80, deadZone: 0.1 };

describe('stickToInput', () => {
  it('внутри мёртвой зоны ввода нет', () => {
    expect(stickToInput(7, 0, p)).toEqual({ x: 0, y: 0 });
  });

  it('на радиусе и дальше сила = 1', () => {
    expect(stickToInput(80, 0, p).x).toBeCloseTo(1);
    expect(stickToInput(0, 200, p).y).toBeCloseTo(-1);
  });

  it('сила растёт линейно от края мёртвой зоны; экранный y инвертирован', () => {
    const v = stickToInput(0, -44, p); // палец вверх на середине рабочего хода
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0.5);
  });
});

describe('followOrigin', () => {
  it('подтягивает центр так, чтобы палец оказался на радиусе', () => {
    const o = followOrigin({ x: 0, y: 0 }, { x: 100, y: 0 }, 80);
    expect(o).toEqual({ x: 20, y: 0 });
  });
});

describe('cursorToInput', () => {
  const p = { deadZone: 0.6, fullDistance: 5 };
  const player = { x: 10, y: -10 };

  it('курсор на персонаже — ввода нет', () => {
    expect(cursorToInput(player, { x: 10.4, y: -10.2 }, p)).toEqual({ x: 0, y: 0 });
  });

  it('сила растёт линейно и насыщается на fullDistance', () => {
    expect(cursorToInput(player, { x: 10, y: -10 + 2.8 }, p).y).toBeCloseTo(0.5); // (2.8 − 0.6) / 4.4
    expect(cursorToInput(player, { x: 10 + 5, y: -10 }, p).x).toBeCloseTo(1);
    const far = cursorToInput(player, { x: 10 - 30, y: -10 - 30 }, p);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
    expect(far.x).toBeLessThan(0);
    expect(far.y).toBeLessThan(0); // мир: y вверх, курсор ниже — вниз
  });
});
