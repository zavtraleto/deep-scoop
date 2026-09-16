import { CELL } from '../core/config';
import type { Vec2 } from '../math/vec2';
import type { WallIndex } from '../world/grid';
import { castVisibility, isVisible, lightStrength, type LightParams, type VisibilityPolygon } from './light';

/**
 * Состояние видимости клеток (§9.2): Unknown → Explored навсегда; Echo — до момента echoUntil.
 * Свет игрока отмечает клетки Explored; эхо отмечает Explored и подсвечивает на glow секунд.
 */
export class VisibilityMap {
  readonly explored: Uint8Array;
  readonly echoUntil: Float32Array;
  /** Порог яркости света, при котором клетка считается увиденной. */
  exploreThreshold = 0.25;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.explored = new Uint8Array(width * height);
    this.echoUntil = new Float32Array(width * height);
  }

  reset(): void {
    this.explored.fill(0);
    this.echoUntil.fill(0);
  }

  isExplored(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height && this.explored[cy * this.width + cx] === 1;
  }

  /** Яркость эха клетки 0..1 в момент now (линейно гаснет за glow секунд). */
  echoLevel(i: number, now: number, glow: number): number {
    const left = this.echoUntil[i] - now;
    return left <= 0 ? 0 : Math.min(1, left / glow);
  }

  /** Отметить увиденными клетки, центры которых освещены и не заслонены стенами. */
  exploreByLight(poly: VisibilityPolygon, heading: number, p: LightParams): number {
    const reach = Math.max(p.radius, p.coneRange);
    const o = poly.origin;
    const cx0 = Math.max(0, Math.floor((o.x - reach) / CELL));
    const cx1 = Math.min(this.width - 1, Math.floor((o.x + reach) / CELL));
    const cy0 = Math.max(0, Math.floor(-(o.y + reach) / CELL));
    const cy1 = Math.min(this.height - 1, Math.floor(-(o.y - reach) / CELL));
    let added = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * this.width + cx;
        if (this.explored[i]) continue;
        const x = (cx + 0.5) * CELL;
        const y = -(cy + 0.5) * CELL;
        const lit = (pt: Vec2) =>
          lightStrength(pt.x - o.x, pt.y - o.y, heading, p) >= this.exploreThreshold && isVisible(poly, pt);
        if (cellSeen(poly, x, y, lit)) {
          this.explored[i] = 1;
          added++;
        }
      }
    }
    return added;
  }

  /**
   * Эхо: кольцо из центра многоугольника расширилось с радиуса r0 до r1 — видимые из центра клетки
   * в этом поясе становятся Explored и ясны до now + glow. Сквозь стены эхо не проходит.
   */
  echoBand(poly: VisibilityPolygon, r0: number, r1: number, now: number, glow: number): void {
    const center = poly.origin;
    const cx0 = Math.max(0, Math.floor((center.x - r1) / CELL));
    const cx1 = Math.min(this.width - 1, Math.floor((center.x + r1) / CELL));
    const cy0 = Math.max(0, Math.floor(-(center.y + r1) / CELL));
    const cy1 = Math.min(this.height - 1, Math.floor(-(center.y - r1) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const x = (cx + 0.5) * CELL;
        const y = -(cy + 0.5) * CELL;
        const d = Math.hypot(x - center.x, y - center.y);
        if (d <= r0 || d > r1) continue;
        if (!cellSeen(poly, x, y)) continue;
        const i = cy * this.width + cx;
        this.explored[i] = 1;
        this.echoUntil[i] = now + glow;
      }
    }
  }
}

/**
 * Видна ли клетка с центром (x, y): её центр или точка чуть за любым краем. Так клетку стены «видно»,
 * когда видна её грань, даже если центр в скале.
 */
const cellSeen = (poly: VisibilityPolygon, x: number, y: number, test: (p: Vec2) => boolean = (p) => isVisible(poly, p)) => {
  const q = CELL * 0.5 + 0.05;
  for (const [dx, dy] of [[0, 0], [q, 0], [-q, 0], [0, q], [0, -q]]) {
    if (test({ x: x + dx, y: y + dy })) return true;
  }
  return false;
};

/** Свет игрока целиком: многоугольник видимости + отметка клеток. */
export const updateLight = (
  map: VisibilityMap,
  pos: Vec2,
  heading: number,
  walls: WallIndex,
  p: LightParams,
): VisibilityPolygon => {
  const poly = castVisibility(pos, heading, walls, p);
  map.exploreByLight(poly, heading, p);
  return poly;
};
