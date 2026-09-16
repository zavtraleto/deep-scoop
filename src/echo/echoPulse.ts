import type { Vec2 } from '../math/vec2';
import type { WallIndex } from '../world/grid';
import { castVisibilityFar, type VisibilityPolygon } from './light';
import type { VisibilityMap } from './visibility';

export interface EchoParams {
  /** Интервал между импульсами, с (Приложение A: 4). */
  interval: number;
  /** Радиус импульса, ед. (8 клеток). */
  radius: number;
  /** Скорость расширения кольца, ед./с (20 клеток/с). */
  speed: number;
  /** Сколько клетка светится после прохода кольца, с (1.5). */
  glow: number;
}

export interface EchoRing {
  origin: Vec2;
  /** Текущий радиус кольца, ед. */
  radius: number;
  /** Сколько секунд прошло с импульса. Кольцо живёт, пока не догорит свечение за фронтом. */
  age: number;
  /** Что видно из точки импульса: дальше стен волна не идёт (решение пользователя). */
  poly: VisibilityPolygon;
}

/** Лучей на импульс: на радиусе 100 ед. между соседними меньше 0.5 ед. */
const ECHO_RAYS = 1440;

/** Многоугольник видимости для импульса: круг радиуса эха, лучи идут по клеткам — дальний радиус недорог. */
export const echoVisibility = (origin: Vec2, walls: WallIndex, p: EchoParams): VisibilityPolygon =>
  castVisibilityFar(origin, walls, p.radius, ECHO_RAYS);

/**
 * Эхо (§9.1): импульс срабатывает сам по таймеру; кольцо расходится от точки, где был игрок,
 * и раскрывает клетки, через которые прошло. Сквозь стены волна не проходит (решение пользователя,
 * отличается от §16): раскрывается только то, что видно из точки импульса.
 */
export class EchoPulse {
  /** Сколько секунд осталось до импульса. */
  countdown: number;
  readonly rings: EchoRing[] = [];
  /** Импульсов за последний шаг (для эффектов). */
  firedThisStep = 0;

  constructor(private readonly p: EchoParams) {
    this.countdown = p.interval;
  }

  reset(): void {
    this.countdown = this.p.interval;
    this.rings.length = 0;
  }

  /** Доля заряда 0..1 — для кольца вокруг игрока. */
  get charge(): number {
    return 1 - Math.max(0, this.countdown) / this.p.interval;
  }

  step(dt: number, player: Vec2, map: VisibilityMap, walls: WallIndex, now: number): void {
    this.firedThisStep = 0;
    this.countdown -= dt;
    if (this.countdown <= 0) {
      this.countdown = this.p.interval;
      const origin = { ...player };
      this.rings.push({ origin, radius: 0, age: 0, poly: echoVisibility(origin, walls, this.p) });
      this.firedThisStep++;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.age += dt;
      const r0 = ring.radius;
      if (r0 < this.p.radius) {
        const r1 = Math.min(this.p.radius, r0 + this.p.speed * dt);
        map.echoBand(ring.poly, r0 === 0 ? -1 : r0, r1, now, this.p.glow);
        ring.radius = r1;
      }
      // Кольцо дошло до края и свечение за ним погасло.
      if (ring.age > this.p.radius / this.p.speed + this.p.glow) this.rings.splice(i, 1);
    }
  }
}
