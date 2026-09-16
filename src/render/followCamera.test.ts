import { describe, expect, it } from 'vitest';
import { FollowCamera } from './followCamera';

describe('FollowCamera.screenToWorld', () => {
  const at = (w: number, h: number) => {
    const cam = new FollowCamera();
    cam.resize(w, h);
    cam.snapTo({ x: 3, y: -7 });
    cam.update({ x: 3, y: -7 }, { x: 0, y: 0 }, 0);
    return cam;
  };

  it('центр экрана — точка под камерой', () => {
    const p = at(800, 600).screenToWorld(0.5, 0.5);
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(-7);
  });

  it('низ экрана — ниже в мире; расстояния не зависят от размера окна', () => {
    const small = at(800, 600).screenToWorld(0.5, 1);
    const big = at(1600, 1200).screenToWorld(0.5, 1);
    expect(small.y).toBeLessThan(-7);
    expect(big.y).toBeCloseTo(small.y);
    // Короткая сторона показывает viewSize (24 ед.): от центра до края — 12.
    expect(small.y).toBeCloseTo(-7 - 12);
  });
});
