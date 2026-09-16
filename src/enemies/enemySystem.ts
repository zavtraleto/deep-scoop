import { angleDelta, clamp, damp, type Vec2 } from '../math/vec2';
import { resolveCircleVsWalls } from '../world/collision';
import type { WallIndex } from '../world/grid';
import { createEnemy, resetEnemy, targetFns, type Enemy, type EnemyKind, type InfoSource } from './enemy';
import { segmentClear, type NavGrid } from './navGrid';

export interface EnemyKindParams {
  /** Максимальная скорость, ед./с. */
  speed: number;
}

export interface EnemyParams {
  /** Радиус тела, ед. (игрок 0.5). */
  radius: number;
  /** Время разгона до максимума, с. */
  accelTime: number;
  /** Скорость поворота тела, рад/с. */
  turnRate: number;
  /** Ближе этого к цели — пришёл, ед. */
  arriveRadius: number;
  /** С какого расстояния до цели начинает тормозить, ед. */
  slowRadius: number;
  /** Как часто пересчитывается путь, с (§10.1: 4 раза в секунду). */
  repathInterval: number;
  /** Сколько путевых точек вперёд пробуем срезать по прямой. */
  lookahead: number;
  /** Пульс слышен сквозь стены в этом радиусе, ед. (решение пользователя). */
  pulseHearRadius: number;
  /** Видит игрока по прямой видимости ближе этого, ед. */
  sightRadius: number;
  /** Как часто проверяется прямая видимость, с. */
  sightInterval: number;
  /** Шум сбора слышен в этом радиусе, ед. */
  noiseRadius: number;
  /** Как часто шум выдаёт позицию, с. */
  noiseInterval: number;
  /** Ускорение врагов, пока игрок шумит (§10.3: +25%). */
  noiseSpeedBonus: number;
  /** С какой доли груза обнаружение усиливается (§11: 50%). */
  cargoThreshold: number;
  /** Во сколько раз растут радиусы обнаружения с грузом. */
  cargoDetectScale: number;
  /** Игрок движется, если быстрее этого, ед./с — иначе направление неизвестно. */
  moveDirMinSpeed: number;
  /** Длительность вспышки «заметил», с. */
  alertTime: number;
  kinds: Record<EnemyKind, EnemyKindParams>;
}

export interface EnemySpawn {
  kind: EnemyKind;
  pos: Vec2;
}

/** Что происходит с игроком на этом шаге. */
export interface EnemyWorld {
  player: Vec2;
  playerVel: Vec2;
  playerRadius: number;
  /** Ковш стирает (§6.4). */
  noisy: boolean;
  /** Груз / лимит. */
  cargoRatio: number;
}

/** Фронт пульса дошёл до врага — для маркера на экране (§9.3). */
export interface PingEvent {
  enemy: Enemy;
  pos: Vec2;
}

interface PendingPulse {
  origin: Vec2;
  dir: Vec2 | null;
  firedAt: number;
  speed: number;
  heard: Set<number>;
}

/**
 * Враги (этап 4, спецификация пользователя). Враг не знает, где игрок: позицию дают только
 * события обнаружения — пульс (слышен сквозь стены, доходит со скоростью волны), шум сбора
 * и прямая видимость вблизи. Между событиями враг работает с последней известной позицией.
 * Общие для всех типов поиск пути и движение с инерцией; тип врага задаёт только выбор цели.
 */
export class EnemySystem {
  readonly enemies: Enemy[];
  readonly pings: PingEvent[] = [];
  /** Игрок пойман на этом шаге. */
  caught = false;
  private readonly pulses: PendingPulse[] = [];
  private noiseTimer = 0;
  private sightTimer = 0;
  private now = 0;

  constructor(
    spawns: readonly EnemySpawn[],
    private readonly nav: NavGrid,
    /** Стены для тела и срезания пути: с закрытой базой. */
    private readonly bodyWalls: WallIndex,
    /** Настоящие стены — для прямой видимости. */
    private readonly sightWalls: WallIndex,
    private readonly p: EnemyParams,
  ) {
    this.enemies = spawns.map((s) => createEnemy(s.kind, s.pos));
  }

  reset(): void {
    for (const e of this.enemies) resetEnemy(e);
    this.pulses.length = 0;
    this.pings.length = 0;
    this.caught = false;
    this.noiseTimer = 0;
    this.sightTimer = 0;
  }

  /** Игрок выпустил импульс эха: волна со скоростью speed понесёт его позицию врагам. */
  pulse(origin: Vec2, playerVel: Vec2, speed: number): void {
    this.pulses.push({ origin: { ...origin }, dir: this.moveDir(playerVel), firedAt: this.now, speed, heard: new Set() });
  }

  step(dt: number, w: EnemyWorld): void {
    this.now += dt;
    this.caught = false;
    const p = this.p;
    const detect = w.cargoRatio >= p.cargoThreshold ? p.cargoDetectScale : 1;

    for (const e of this.enemies) {
      e.prevPos.x = e.pos.x;
      e.prevPos.y = e.pos.y;
      e.prevHeading = e.heading;
      e.alert = Math.max(0, e.alert - dt / p.alertTime);
    }

    // Пульс: фронт доходит до врага — враг узнаёт, где игрок был в момент импульса.
    const hear = p.pulseHearRadius * detect;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      const front = Math.min((this.now - pulse.firedAt) * pulse.speed, hear);
      for (const e of this.enemies) {
        if (pulse.heard.has(e.id)) continue;
        const d = Math.hypot(e.pos.x - pulse.origin.x, e.pos.y - pulse.origin.y);
        if (d > front) continue;
        pulse.heard.add(e.id);
        this.inform(e, pulse.origin, pulse.dir, d, 'pulse');
        this.pings.push({ enemy: e, pos: { ...e.pos } });
      }
      if (front >= hear) this.pulses.splice(i, 1);
    }

    // Шум сбора: пока ковш стирает, ближние враги периодически слышат, где игрок.
    this.noiseTimer -= dt;
    if (w.noisy && this.noiseTimer <= 0) {
      this.noiseTimer = p.noiseInterval;
      const dir = this.moveDir(w.playerVel);
      for (const e of this.enemies) {
        const d = Math.hypot(e.pos.x - w.player.x, e.pos.y - w.player.y);
        if (d <= p.noiseRadius * detect) this.inform(e, w.player, dir, d, 'noise');
      }
    }

    // Прямая видимость вблизи: видит — знает; скрылся за стеной — остаётся последняя позиция.
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = p.sightInterval;
      const dir = this.moveDir(w.playerVel);
      for (const e of this.enemies) {
        const d = Math.hypot(e.pos.x - w.player.x, e.pos.y - w.player.y);
        const sees = d <= p.sightRadius * detect && segmentClear(this.sightWalls, e.pos, w.player, 0);
        if (sees) this.inform(e, w.player, dir, d, 'sight');
        e.sees = sees;
      }
    }

    const speedScale = w.noisy ? 1 + p.noiseSpeedBonus : 1;
    for (const e of this.enemies) {
      this.steer(e, dt, speedScale);
      const d = Math.hypot(e.pos.x - w.player.x, e.pos.y - w.player.y);
      if (d < p.radius + w.playerRadius) this.caught = true;
    }
  }

  private moveDir(vel: Vec2): Vec2 | null {
    const s = Math.hypot(vel.x, vel.y);
    return s > this.p.moveDirMinSpeed ? { x: vel.x / s, y: vel.y / s } : null;
  }

  private inform(e: Enemy, pos: Vec2, dir: Vec2 | null, distance: number, source: InfoSource): void {
    // Видимый игрок обновляется непрерывно — вспышка только на первое обнаружение.
    if (source !== 'sight' || !e.sees) e.alert = 1;
    e.info = { pos: { ...pos }, dir: dir && { ...dir }, distance, time: this.now, source };
    e.target = targetFns[e.kind](e, e.info);
    e.arrived = false;
    e.repath = 0;
  }

  private steer(e: Enemy, dt: number, speedScale: number): void {
    const p = this.p;
    const maxSpeed = p.kinds[e.kind].speed * speedScale;
    let desiredX = 0;
    let desiredY = 0;

    if (e.target && !e.arrived) {
      e.repath -= dt;
      if (e.repath <= 0) {
        e.repath = p.repathInterval;
        e.path = this.nav.findPath(e.pos, e.target).points;
      }
      // Пропускаем точки, до которых уже добрались.
      while (e.path.length > 1 && Math.hypot(e.path[0].x - e.pos.x, e.path[0].y - e.pos.y) < p.arriveRadius) {
        e.path.shift();
      }
      const final = e.path[e.path.length - 1];
      if (!final || Math.hypot(final.x - e.pos.x, final.y - e.pos.y) < p.arriveRadius) {
        e.arrived = true;
        e.path.length = 0;
      } else {
        // Срезаем путь: самая дальняя из ближайших точек, до которой тело проходит по прямой.
        let aim = e.path[0];
        const n = Math.min(e.path.length, p.lookahead);
        for (let i = n - 1; i > 0; i--) {
          if (segmentClear(this.bodyWalls, e.pos, e.path[i], p.radius * 0.9)) {
            aim = e.path[i];
            break;
          }
        }
        const dx = aim.x - e.pos.x;
        const dy = aim.y - e.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        const toFinal = Math.hypot(final.x - e.pos.x, final.y - e.pos.y);
        const speed = maxSpeed * clamp(toFinal / p.slowRadius, 0.25, 1);
        desiredX = (dx / len) * speed;
        desiredY = (dy / len) * speed;
      }
    }

    // Инерция: скорость тянется к желаемой, разгон до максимума за accelTime.
    const k = damp(3 / p.accelTime, dt);
    e.vel.x += (desiredX - e.vel.x) * k;
    e.vel.y += (desiredY - e.vel.y) * k;
    e.pos.x += e.vel.x * dt;
    e.pos.y += e.vel.y * dt;
    resolveCircleVsWalls(e.pos, e.vel, p.radius, this.bodyWalls);

    const s = Math.hypot(e.vel.x, e.vel.y);
    if (s > 0.2) {
      const want = Math.atan2(e.vel.y, e.vel.x);
      e.heading += clamp(angleDelta(e.heading, want), -p.turnRate * dt, p.turnRate * dt);
    }
  }
}
