import type { Segment, Vec2 } from '../math/vec2';
import type { WallIndex } from '../world/grid';

/** Сентинел «ещё не открыт» для времени открытия отрезка. */
export const HIDDEN = 1e9;

export type BlipKind = 'item' | 'enemy';

/** Сущность, которую может засечь развёртка. key — сама сущность (объект, кусок, враг). */
export interface Tracked {
  key: object;
  kind: BlipKind;
  pos: Vec2;
}

/** Точка на карте: где развёртка застала сущность. */
export interface Blip {
  kind: BlipKind;
  pos: Vec2;
  /** Когда засекли, с симуляции. */
  time: number;
}

interface Sweep {
  origin: Vec2;
  firedAt: number;
  pinged: Set<object>;
}

/**
 * Знание карты (решения пользователя, «локатор из „Чужого“»).
 * Контуры стен — только то, что игрок видел сам: светом или эхом (оно сквозь стены не идёт).
 * Развёртка — второй фронт того же импульса: та же скорость, но дальше и сквозь стены; она
 * открывает не стены, а только точки предметов и врагов там, где их застала.
 */
export class MapKnowledge {
  readonly segments: readonly Segment[];
  /** Время открытия каждого отрезка (с симуляции) или HIDDEN. */
  readonly revealed: Float32Array;
  /** Отрезки, открытые с прошлого опроса. Потребитель очищает сам. */
  readonly changed: number[] = [];
  readonly blips = new Map<object, Blip>();
  private readonly sweeps: Sweep[] = [];
  private readonly cellSegments: Int32Array[];

  constructor(walls: WallIndex) {
    this.segments = walls.all;
    this.revealed = new Float32Array(this.segments.length).fill(HIDDEN);
    const index = new Map<Segment, number>();
    this.segments.forEach((s, i) => index.set(s, i));
    this.cellSegments = [];
    for (let cy = 0; cy < walls.height; cy++) {
      for (let cx = 0; cx < walls.width; cx++) {
        this.cellSegments.push(Int32Array.from(walls.inCell(cx, cy), (s) => index.get(s)!));
      }
    }
  }

  reset(): void {
    this.revealed.fill(HIDDEN);
    this.changed.length = 0;
    this.blips.clear();
    this.sweeps.length = 0;
  }

  get sweeping(): number {
    return this.sweeps.length;
  }

  private reveal(i: number, now: number): void {
    if (this.revealed[i] !== HIDDEN) return;
    this.revealed[i] = now;
    this.changed.push(i);
  }

  /** Открыть контуры клетки чанка (клетка стала изведанной у игрока). */
  revealCell(cellIndex: number, now: number): void {
    for (const i of this.cellSegments[cellIndex] ?? []) this.reveal(i, now);
  }

  /** Импульс эха: запустить развёртку из origin. */
  fire(origin: Vec2, now: number): void {
    this.sweeps.push({ origin: { ...origin }, firedAt: now, pinged: new Set() });
  }

  /**
   * Продвинуть фронты. Точки: засечённая сущность получает точку на месте, где её застал фронт.
   * Если фронт прошёл по точке предмета, а самого предмета там не застал (стёрт или уплыл), точка стирается.
   * Точки врагов живут enemyLife секунд.
   */
  step(now: number, speed: number, radius: number, tracked: readonly Tracked[], enemyLife: number): void {
    for (let k = this.sweeps.length - 1; k >= 0; k--) {
      const sw = this.sweeps[k];
      const r = Math.min((now - sw.firedAt) * speed, radius);
      for (const t of tracked) {
        if (sw.pinged.has(t.key)) continue;
        if (Math.hypot(t.pos.x - sw.origin.x, t.pos.y - sw.origin.y) > r) continue;
        sw.pinged.add(t.key);
        this.blips.set(t.key, { kind: t.kind, pos: { ...t.pos }, time: now });
      }
      for (const [key, b] of this.blips) {
        if (b.kind !== 'item' || b.time >= sw.firedAt || sw.pinged.has(key)) continue;
        if (Math.hypot(b.pos.x - sw.origin.x, b.pos.y - sw.origin.y) <= r) this.blips.delete(key);
      }
      if (r >= radius) this.sweeps.splice(k, 1);
    }
    for (const [key, b] of this.blips) {
      if (b.kind === 'enemy' && now - b.time > enemyLife) this.blips.delete(key);
    }
  }
}
