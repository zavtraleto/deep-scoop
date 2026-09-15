import { describe, expect, it } from 'vitest';
import { followOrigin, stickToInput } from './stickMath';

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
