import type { Vec2 } from '../math/vec2';

/** Стёртый пиксель, из которого можно выпустить частицу. Координаты в пикселях маски. */
export interface ErasedSample {
  px: number;
  py: number;
}

/**
 * Маска стирания объекта (§6.3). Пиксели маски: x вправо, y вверх (строка 0 — низ изображения).
 * opaque — непрозрачные пиксели исходной картинки, erased — стёртые (0 или 255: удобно как текстура).
 */
export class EraseMask {
  readonly erased: Uint8Array;
  readonly totalOpaque: number;
  erasedOpaque = 0;
  /** Маска менялась с последней выгрузки в текстуру. */
  dirty = true;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly opaque: Uint8Array,
  ) {
    this.erased = new Uint8Array(width * height);
    let total = 0;
    for (let i = 0; i < opaque.length; i++) total += opaque[i] ? 1 : 0;
    this.totalOpaque = total;
  }

  /** Прогресс извлечения = стёртые непрозрачные пиксели / все непрозрачные. */
  get progress(): number {
    return this.totalOpaque === 0 ? 0 : this.erasedOpaque / this.totalOpaque;
  }

  reset(): void {
    this.erased.fill(0);
    this.erasedOpaque = 0;
    this.dirty = true;
  }

  /**
   * Закрасить выпуклый многоугольник (вершины в пикселях маски, любой обход).
   * Пиксель стирается, если его центр внутри. Возвращает число впервые стёртых непрозрачных пикселей;
   * часть из них (не больше maxSamples, равномерно) складывает в samples.
   */
  fillConvex(points: readonly Vec2[], samples?: ErasedSample[], maxSamples = 0): number {
    if (points.length < 3) return 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const row0 = Math.max(0, Math.ceil(minY - 0.5));
    const row1 = Math.min(this.height - 1, Math.floor(maxY - 0.5));
    let newly = 0;
    let seen = 0;

    for (let row = row0; row <= row1; row++) {
      const y = row + 0.5;
      // Пересечение горизонтали с выпуклым многоугольником — один отрезок [xl, xr].
      let xl = Infinity;
      let xr = -Infinity;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
          if (a.y === b.y) {
            xl = Math.min(xl, a.x, b.x);
            xr = Math.max(xr, a.x, b.x);
          } else {
            const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
            xl = Math.min(xl, x);
            xr = Math.max(xr, x);
          }
        }
      }
      if (xl > xr) continue;
      const col0 = Math.max(0, Math.ceil(xl - 0.5));
      const col1 = Math.min(this.width - 1, Math.floor(xr - 0.5));
      const base = row * this.width;
      for (let col = col0; col <= col1; col++) {
        const i = base + col;
        if (this.erased[i]) continue;
        this.erased[i] = 255;
        this.dirty = true;
        if (!this.opaque[i]) continue;
        newly++;
        seen++;
        // Прореживание: берём каждый ~k-й пиксель, пока есть место.
        if (samples && samples.length < maxSamples && seen % 23 === 1) samples.push({ px: col, py: row });
      }
    }
    this.erasedOpaque += newly;
    return newly;
  }
}

/** Выпуклая оболочка набора точек (монотонная цепь Эндрю), обход против часовой. */
export const convexHull = (input: readonly Vec2[]): Vec2[] => {
  const pts = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
};
