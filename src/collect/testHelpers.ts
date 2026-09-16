// Общие заготовки для тестов сбора. В игровой код не импортируется.
import { createRootObject, maskSize, type MemoryObject } from './memoryObject';
import type { ScoopParams } from './scoop';

export const testScoop: ScoopParams = {
  width: 1.2,
  depth: 0.6,
  offset: 0.3,
  followNose: false,
  noseBlendSpeed: 1,
  turnRate: 1000, // мгновенный поворот — тестам нужна чистая геометрия
};

/** Сплошной прямоугольный объект width×height с центром center, 32 px/ед. */
export const solidObject = (width = 7, height = width, value = 6, center = { x: 0, y: 0 }): MemoryObject => {
  const { w, h } = maskSize(width, height, 32);
  return createRootObject({
    cls: 'large',
    center,
    width,
    height,
    value,
    opaque: new Uint8Array(w * h).fill(1),
    maskWidth: w,
    maskHeight: h,
    phase: [0, 1, 2, 3],
  });
};

/** Детерминированный генератор для тестов. */
export const seededRng = (seed = 1) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};
