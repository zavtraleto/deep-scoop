import type { Vec2 } from '../math/vec2';
import type { WallIndex } from '../world/grid';
import { addCargo, stepCollect, type Cargo, type CollectResult } from './collector';
import { applyNudge, stepFloat, type FloatParams } from './floatPhysics';
import { fracture, type FractureParams } from './fracture';
import type { MemoryObject, ObjectSample } from './memoryObject';
import type { ScoopParams, ScoopState } from './scoop';

export interface CollectWorldParams {
  scoop: ScoopParams;
  float: FloatParams;
  fracture: FractureParams;
  /** Как часто (с) проверять стираемый объект на раскол. */
  fractureCheckInterval: number;
}

export type WorldEvent = { type: 'added'; object: MemoryObject; bySplit: boolean } | { type: 'removed'; object: MemoryObject };

export interface PlayerState {
  pos: Vec2;
  vel: Vec2;
  heading: number;
}

/**
 * Все Memory Objects уровня: парение, сбор, толчки и раскол. Без three.js.
 * Отрисовка забирает события (добавлен/удалён объект) и частицы из очередей.
 */
export class CollectWorld {
  objects: MemoryObject[] = [];
  readonly events: WorldEvent[] = [];
  /** Стёртые пиксели для частиц, летящих в игрока. */
  readonly samples: ObjectSample[] = [];
  /** Частицы вспышки разреза: разлетаются и гаснут. */
  readonly burst: ObjectSample[] = [];

  constructor(private readonly rng: () => number = Math.random) {}

  add(obj: MemoryObject): void {
    this.objects.push(obj);
    this.events.push({ type: 'added', object: obj, bySplit: false });
  }

  clear(): void {
    for (const obj of this.objects) this.events.push({ type: 'removed', object: obj });
    this.objects = [];
  }

  step(
    player: PlayerState,
    scoop: ScoopState,
    cargo: Cargo,
    walls: WallIndex | null,
    p: CollectWorldParams,
    dt: number,
    samplesPerStep = 0,
  ): CollectResult {
    stepFloat(this.objects, walls, p.float, dt);

    const res = stepCollect(
      scoop,
      player.pos,
      player.vel,
      player.heading,
      this.objects,
      cargo,
      p.scoop,
      dt,
      this.samples,
      this.samples.length + samplesPerStep,
    );

    const front = {
      x: (res.shape.frontA.x + res.shape.frontB.x) / 2,
      y: (res.shape.frontA.y + res.shape.frontB.y) / 2,
    };
    for (const obj of this.objects) {
      if (obj.erasedThisStep > 0) {
        applyNudge(obj, front, player.vel, obj.erasedThisStep * obj.pixelW * obj.pixelH, p.float);
      }
    }

    this.checkFractures(player, scoop, cargo, p, dt);
    return res;
  }

  private checkFractures(player: PlayerState, scoop: ScoopState, cargo: Cargo, p: CollectWorldParams, dt: number) {
    const speed = Math.hypot(player.vel.x, player.vel.y);
    const dir = speed > 0.1 ? { x: player.vel.x / speed, y: player.vel.y / speed } : { x: Math.cos(scoop.angle), y: Math.sin(scoop.angle) };
    const next: MemoryObject[] = [];
    for (const obj of this.objects) {
      obj.fractureCooldown -= dt;
      // Проверяем раз в интервал, пока объект стирают, и сразу, как только стирать перестали.
      const due = obj.needsFractureCheck && (obj.fractureCooldown <= 0 || obj.erasedThisStep === 0);
      if (!due) {
        next.push(obj);
        continue;
      }
      obj.needsFractureCheck = false;
      obj.fractureCooldown = p.fractureCheckInterval;

      const r = fracture(obj, { point: player.pos, dir, playerVel: player.vel }, p.fracture, this.rng);
      addCargo(cargo, obj, r.crumbPixels);
      this.samples.push(...r.crumbSamples);
      this.burst.push(...r.burstSamples);
      if (r.pieces === null) {
        next.push(obj);
        continue;
      }
      this.events.push({ type: 'removed', object: obj });
      for (const piece of r.pieces) {
        next.push(piece);
        this.events.push({ type: 'added', object: piece, bySplit: true });
      }
    }
    this.objects = next;
  }
}
