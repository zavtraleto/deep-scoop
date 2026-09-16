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

/** Исходный целый объект, от которого произошли куски: картинка, размер маски и ценность на всех. */
export interface ObjectRoot {
  id: number;
  maskWidth: number;
  maskHeight: number;
  totalOpaque: number;
  value: number;
}

/**
 * Физическое тело парящего объекта. pos — мировая точка опоры (pivot), angle — поворот вокруг неё.
 * home — точка, вокруг которой объект парит; пока drifting, объект ещё разлетается и дом не задан.
 */
export interface FloatBody {
  pos: Vec2;
  vel: Vec2;
  angle: number;
  angVel: number;
  prevPos: Vec2;
  prevAngle: number;
  home: Vec2;
  homeAngle: number;
  drifting: boolean;
  /** Время с момента появления (для разлёта) и фазы парения — у каждого объекта свой ритм. */
  age: number;
  phase: [number, number, number, number];
}

export interface ObjectSample extends ErasedSample {
  /** Мировые координаты стёртого пикселя. */
  x: number;
  y: number;
  object: MemoryObject;
}

export interface MemoryObjectInit {
  cls: ObjectClass;
  root: ObjectRoot;
  mask: EraseMask;
  /** Размер пикселя маски в мировых единицах. */
  pixelW: number;
  pixelH: number;
  /** Смещение маски куска внутри маски корня, пиксели. */
  offsetX: number;
  offsetY: number;
  /** Точка опоры в локальных единицах от левого нижнего угла маски. */
  pivot: Vec2;
  pos: Vec2;
  angle: number;
  vel?: Vec2;
  angVel?: number;
  drifting?: boolean;
  phase: [number, number, number, number];
}

/**
 * Memory Object (§6.2, §7): плоская картинка, не твёрдая, свободно парящая.
 * Кусок после раскола — тоже MemoryObject: своя маска-вырезка из маски корня и своё тело.
 */
export class MemoryObject {
  readonly cls: ObjectClass;
  readonly root: ObjectRoot;
  readonly mask: EraseMask;
  readonly pixelW: number;
  readonly pixelH: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pivot: Vec2;
  readonly body: FloatBody;
  /** Максимальное расстояние от опоры до угла маски: грубая граница для отсева. */
  readonly boundRadius: number;
  /** Стёрто непрозрачных пикселей на текущем шаге. */
  erasedThisStep = 0;
  /** Маска менялась после последней проверки на раскол. */
  needsFractureCheck = false;
  fractureCooldown = 0;

  constructor(init: MemoryObjectInit) {
    this.cls = init.cls;
    this.root = init.root;
    this.mask = init.mask;
    this.pixelW = init.pixelW;
    this.pixelH = init.pixelH;
    this.offsetX = init.offsetX;
    this.offsetY = init.offsetY;
    this.pivot = init.pivot;
    const pos = { ...init.pos };
    this.body = {
      pos,
      vel: { ...(init.vel ?? { x: 0, y: 0 }) },
      angle: init.angle,
      angVel: init.angVel ?? 0,
      prevPos: { ...pos },
      prevAngle: init.angle,
      home: { ...pos },
      homeAngle: init.angle,
      drifting: init.drifting ?? false,
      age: 0,
      phase: init.phase,
    };
    const w = this.width;
    const h = this.height;
    this.boundRadius = Math.max(
      Math.hypot(this.pivot.x, this.pivot.y),
      Math.hypot(w - this.pivot.x, this.pivot.y),
      Math.hypot(this.pivot.x, h - this.pivot.y),
      Math.hypot(w - this.pivot.x, h - this.pivot.y),
    );
  }

  get width(): number {
    return this.mask.width * this.pixelW;
  }

  get height(): number {
    return this.mask.height * this.pixelH;
  }

  /** Ценность этого объекта: доля ценности корня по числу его нестёртых пикселей при создании. */
  get value(): number {
    return (this.root.value * this.mask.totalOpaque) / this.root.totalOpaque;
  }

  get progress(): number {
    return this.mask.progress;
  }

  /** Площадь нестёртой картинки, ед.². */
  get area(): number {
    return this.mask.remaining * this.pixelW * this.pixelH;
  }

  /** Мировая точка → непрерывные координаты маски (пиксели). */
  toMask(p: Vec2): Vec2 {
    const { pos, angle } = this.body;
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const lx = dx * c + dy * s + this.pivot.x;
    const ly = -dx * s + dy * c + this.pivot.y;
    return { x: lx / this.pixelW, y: ly / this.pixelH };
  }

  /** Непрерывные координаты маски → мировая точка. Центр пикселя (px, py) — это (px + 0.5, py + 0.5). */
  maskPointToWorld(mx: number, my: number): Vec2 {
    const { pos, angle } = this.body;
    const lx = mx * this.pixelW - this.pivot.x;
    const ly = my * this.pixelH - this.pivot.y;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: pos.x + lx * c - ly * s, y: pos.y + lx * s + ly * c };
  }

  maskToWorld(px: number, py: number): Vec2 {
    return this.maskPointToWorld(px + 0.5, py + 0.5);
  }

  /** Стереть выпуклый многоугольник в мировых координатах. Возвращает число стёртых непрозрачных пикселей. */
  erase(polygon: readonly Vec2[], samples?: ObjectSample[], maxSamples = 0): number {
    const { pos } = this.body;
    const r = this.boundRadius;
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
    if (maxX < pos.x - r || minX > pos.x + r || maxY < pos.y - r || minY > pos.y + r) return 0;

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
    if (n > 0) {
      this.erasedThisStep += n;
      this.needsFractureCheck = true;
    }
    return n;
  }
}

let nextRootId = 1;

/** Целый объект с центром в center: опора — центр маски, объект парит у точки спавна. */
export const createRootObject = (opts: {
  cls: ObjectClass;
  center: Vec2;
  width: number;
  height: number;
  value: number;
  opaque: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  phase: [number, number, number, number];
}): MemoryObject => {
  const mask = new EraseMask(opts.maskWidth, opts.maskHeight, opts.opaque);
  return new MemoryObject({
    cls: opts.cls,
    root: {
      id: nextRootId++,
      maskWidth: opts.maskWidth,
      maskHeight: opts.maskHeight,
      totalOpaque: mask.totalOpaque,
      value: opts.value,
    },
    mask,
    pixelW: opts.width / opts.maskWidth,
    pixelH: opts.height / opts.maskHeight,
    offsetX: 0,
    offsetY: 0,
    pivot: { x: opts.width / 2, y: opts.height / 2 },
    pos: opts.center,
    angle: 0,
    phase: opts.phase,
  });
};
