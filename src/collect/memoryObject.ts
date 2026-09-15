import type { Vec2 } from '../math/vec2';
import { EraseMask, type ErasedSample } from './eraseMask';

export type ObjectClass = 'small' | 'medium' | 'large';

export interface ObjectClassDef {
  /** Размер большей стороны относительно диаметра игрока (§7). */
  size: number;
  /** Базовая ценность (§7). */
  value: number;
}

/** §7: ценность умножается на 1 + 0.25 · chunkIndex. */
export const objectValue = (base: number, chunkIndex: number): number => base * (1 + 0.25 * chunkIndex);

/** Размер маски: pixelsPerUnit по каждой стороне, но не меньше 1 пикселя. */
export const maskSize = (width: number, height: number, pixelsPerUnit: number) => ({
  w: Math.max(1, Math.round(width * pixelsPerUnit)),
  h: Math.max(1, Math.round(height * pixelsPerUnit)),
});

export interface ObjectSample extends ErasedSample {
  /** Мировые координаты стёртого пикселя. */
  x: number;
  y: number;
  object: MemoryObject;
}

/**
 * Memory Object (§6.2, §7): плоская картинка, не твёрдая. Прямоугольник мира с центром center
 * и размерами width × height, на который натянута маска стирания.
 */
export class MemoryObject {
  constructor(
    readonly center: Vec2,
    readonly width: number,
    readonly height: number,
    readonly cls: ObjectClass,
    readonly value: number,
    readonly mask: EraseMask,
  ) {}

  get left(): number {
    return this.center.x - this.width / 2;
  }

  get bottom(): number {
    return this.center.y - this.height / 2;
  }

  get progress(): number {
    return this.mask.progress;
  }

  toMask(p: Vec2): Vec2 {
    return {
      x: ((p.x - this.left) / this.width) * this.mask.width,
      y: ((p.y - this.bottom) / this.height) * this.mask.height,
    };
  }

  /** Центр пикселя маски в мировых координатах. */
  maskToWorld(px: number, py: number): Vec2 {
    return {
      x: this.left + ((px + 0.5) / this.mask.width) * this.width,
      y: this.bottom + ((py + 0.5) / this.mask.height) * this.height,
    };
  }

  /** Стереть выпуклый многоугольник в мировых координатах. Возвращает число стёртых непрозрачных пикселей. */
  erase(polygon: readonly Vec2[], samples?: ObjectSample[], maxSamples = 0): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (maxX < this.left || minX > this.left + this.width || maxY < this.bottom || minY > this.bottom + this.height) {
      return 0;
    }
    const local: ErasedSample[] = [];
    const room = samples ? Math.max(0, maxSamples - samples.length) : 0;
    const n = this.mask.fillConvex(
      polygon.map((p) => this.toMask(p)),
      samples ? local : undefined,
      room,
    );
    if (samples) {
      for (const s of local) samples.push({ ...s, ...this.maskToWorld(s.px, s.py), object: this });
    }
    return n;
  }
}
