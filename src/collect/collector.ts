import type { Vec2 } from '../math/vec2';
import { convexHull } from './eraseMask';
import type { MemoryObject, ObjectSample } from './memoryObject';
import { scoopShape, scoopTargetAngle, updateScoopAngle, type ScoopParams, type ScoopState } from './scoop';

export interface Cargo {
  cargo: number;
  cargoMax: number;
}

export interface CollectResult {
  /** Стёртые за шаг непрозрачные пиксели всех объектов. */
  erasedPixels: number;
  /** §6.4: за шаг стёрт хотя бы один пиксель. */
  noise: boolean;
}

/**
 * Один шаг сбора: повернуть ковш, стереть полосу между прошлым и текущим передним краем (§6.3)
 * и сам прямоугольник ковша, начислить груз (§11): cargo += Δprogress · value, не больше cargoMax.
 * Полоса — выпуклая оболочка двух положений переднего края: без разрывов на любой скорости.
 */
export const stepCollect = (
  scoop: ScoopState,
  pos: Vec2,
  vel: Vec2,
  heading: number,
  objects: readonly MemoryObject[],
  cargo: Cargo,
  p: ScoopParams,
  dt: number,
  samples?: ObjectSample[],
  maxSamples = 0,
): CollectResult => {
  updateScoopAngle(scoop, scoopTargetAngle(vel, heading, p), p, dt);
  const shape = scoopShape(pos, scoop.angle, p);
  const sweep = convexHull([scoop.prevFrontA ?? shape.frontA, scoop.prevFrontB ?? shape.frontB, shape.frontA, shape.frontB]);
  scoop.prevFrontA = shape.frontA;
  scoop.prevFrontB = shape.frontB;

  let erasedPixels = 0;
  for (const obj of objects) {
    const n = obj.erase(sweep, samples, maxSamples) + obj.erase(shape.rect, samples, maxSamples);
    if (n === 0) continue;
    erasedPixels += n;
    const gain = (n / obj.mask.totalOpaque) * obj.value;
    cargo.cargo = Math.min(cargo.cargoMax, cargo.cargo + gain);
  }
  return { erasedPixels, noise: erasedPixels > 0 };
};
