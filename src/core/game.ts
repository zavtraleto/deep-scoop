import * as THREE from 'three';
import { cargoConfig, collectConfig, movementConfig, physicsConfig, PLAYER_RADIUS } from './config';
import { CollectWorld } from '../collect/collectWorld';
import type { Cargo } from '../collect/collector';
import { EraseParticles } from '../collect/eraseParticles';
import type { MemoryObject, ObjectSample } from '../collect/memoryObject';
import { MemoryObjectView } from '../collect/memoryObjectView';
import { buildTelevision, type ObjectArt } from '../collect/objectArt';
import { createScoopState, type ScoopState } from '../collect/scoop';
import { ScoopView } from '../collect/scoopView';
import { createTuningPanel, type TuningRun, type TuningStats } from '../debug/tuning';
import { Input } from '../input/input';
import { angleDelta, clamp, length, type Vec2 } from '../math/vec2';
import { CargoGauge } from '../player/cargoGauge';
import { createMovementState, massFor, stepMovement, type MovementState } from '../player/movement';
import { PlayerSprite } from '../player/playerSprite';
import { StickZonesDebug } from '../player/stickZonesDebug';
import { FollowCamera } from '../render/followCamera';
import { resolveCircleVsWalls } from '../world/collision';
import type { WallIndex } from '../world/grid';
import { collectTestMap, type ObjectPlacement } from '../world/testMaps';
import { buildWorldMesh, palette } from '../world/worldMesh';

/** Картинка корня объекта: одна текстура на все его куски. */
interface RootArt {
  art: ObjectArt;
  texture: THREE.Texture;
  totalOpaque: number;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam = new FollowCamera();
  private readonly input: Input;
  private readonly sprite = new PlayerSprite();
  private readonly walls: WallIndex;

  private readonly pos: Vec2;
  private readonly prevPos: Vec2;
  private readonly move: MovementState = createMovementState();
  private prevHeading = 0;
  private lastInput: Vec2 = { x: 0, y: 0 };
  private readonly zonesDebug = new StickZonesDebug();

  // Сбор и парящие объекты.
  private readonly world = new CollectWorld();
  private readonly placements: ObjectPlacement[];
  private readonly rootArts = new Map<number, RootArt>();
  private readonly views = new Map<MemoryObject, MemoryObjectView>();
  private readonly scoop: ScoopState = createScoopState();
  private prevScoopAngle = 0;
  private readonly scoopView = new ScoopView();
  private readonly particles = new EraseParticles();
  private readonly gauge = new CargoGauge();
  private erasing = false;
  private readonly run: TuningRun & Cargo;

  private readonly stats: TuningStats = { speed: 0, input: 0, mass: 1, drift: 0, noise: false, progress: 0, pieces: 0 };
  private accumulator = 0;
  private lastTime = -1;
  private time = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.scene.background = palette.wall;

    const map = collectTestMap();
    this.walls = map.grid.buildWalls();
    this.scene.add(buildWorldMesh(map.grid, this.walls));
    this.placements = map.objects;
    this.spawnObjects();

    this.scene.add(this.scoopView.mesh, this.sprite.mesh, this.gauge.mesh, this.particles.points, this.zonesDebug.group);

    this.pos = { ...map.spawn };
    this.prevPos = { ...map.spawn };
    this.cam.snapTo(this.pos);

    this.run = {
      cargo: 0,
      cargoMax: cargoConfig.cargoMax,
      resetObjects: () => {
        this.world.clear();
        this.syncObjectViews(); // убрать старые виды, пока их текстуры ещё живы
        this.spawnObjects();
        this.run.cargo = 0;
      },
    };

    this.input = new Input(container);
    createTuningPanel(this.stats, this.run);

    window.addEventListener('resize', this.resize);
    this.resize();
  }

  start(): void {
    this.renderer.setAnimationLoop(this.frame);
  }

  private spawnObjects() {
    for (const r of this.rootArts.values()) r.texture.dispose();
    this.rootArts.clear();
    for (const { cls, center } of this.placements) {
      const built = buildTelevision(center, cls, collectConfig.classes, PLAYER_RADIUS * 2, collectConfig.maskPixelsPerUnit);
      const texture = new THREE.CanvasTexture(built.art.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      this.rootArts.set(built.object.root.id, { art: built.art, texture, totalOpaque: built.object.root.totalOpaque });
      this.world.add(built.object);
    }
  }

  private resize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // скрытое окно — ждём настоящий размер
    this.renderer.setSize(w, h);
    this.cam.resize(w, h);
  };

  private frame = (timeMs: number) => {
    const now = timeMs / 1000;
    const dt = this.lastTime < 0 ? 0 : clamp(now - this.lastTime, 0, 0.1);
    this.lastTime = now;
    this.time += dt;

    // Фиксированный шаг физики, отрисовка интерполируется между шагами.
    const step = physicsConfig.step;
    this.accumulator += dt;
    let substeps = 0;
    while (this.accumulator >= step && substeps < physicsConfig.maxSubsteps) {
      this.fixedUpdate(step);
      this.accumulator -= step;
      substeps++;
    }
    if (substeps === physicsConfig.maxSubsteps) this.accumulator = 0;

    const alpha = this.accumulator / step;
    const x = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
    const heading = this.prevHeading + (this.move.heading - this.prevHeading) * alpha;
    const scoopAngle = this.prevScoopAngle + angleDelta(this.prevScoopAngle, this.scoop.angle) * alpha;
    const player = { x, y };

    this.syncObjectViews();
    for (const view of this.views.values()) view.update(this.time, alpha, dt);
    this.spawnParticles(this.world.samples, player, true);
    this.spawnParticles(this.world.burst, player, false);
    this.particles.setViewport(this.container.clientHeight, this.cam.camera.fov);
    this.particles.update(dt, player);

    this.sprite.update(x, y, heading);
    this.gauge.update(x, y, heading, this.run.cargo / this.run.cargoMax, this.time, dt);
    this.scoopView.update(x, y, scoopAngle, this.erasing, collectConfig.scoop, dt);
    const m = this.move;
    this.zonesDebug.update(x, y, heading, this.lastInput, m.vel, m.braking, m.drift);
    this.cam.update(player, this.move.vel, dt);
    this.renderer.render(this.scene, this.cam.camera);
  };

  /** Создать и убрать отрисовку по событиям мира: раскол заменяет объект кусками. */
  private syncObjectViews() {
    for (const e of this.world.events) {
      if (e.type === 'removed') {
        this.views.get(e.object)?.dispose();
        this.views.delete(e.object);
        continue;
      }
      const rootArt = this.rootArts.get(e.object.root.id);
      if (!rootArt) continue;
      const view = new MemoryObjectView(e.object, rootArt.texture, e.bySplit ? 1 : 0);
      this.views.set(e.object, view);
      this.scene.add(view.mesh);
    }
    this.world.events.length = 0;
  }

  private spawnParticles(samples: ObjectSample[], player: Vec2, homing: boolean) {
    for (const s of samples) {
      const root = this.rootArts.get(s.object.root.id);
      if (!root) continue;
      const i = ((s.py + s.object.offsetY) * root.art.maskWidth + s.px + s.object.offsetX) * 3;
      const c = root.art.colors;
      this.particles.spawn(s, player, c[i], c[i + 1], c[i + 2], homing);
    }
    samples.length = 0;
  }

  private fixedUpdate(dt: number) {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevHeading = this.move.heading;
    this.prevScoopAngle = this.scoop.angle;

    const input = this.input.vector({
      player: this.pos,
      screenToWorld: (u, v) => this.cam.screenToWorld(u, v),
    });
    this.lastInput = input;
    this.run.cargoMax = cargoConfig.cargoMax;
    const mass = massFor(this.run.cargo, this.run.cargoMax, movementConfig.baseMass);
    stepMovement(this.move, input, mass, movementConfig, dt);

    this.pos.x += this.move.vel.x * dt;
    this.pos.y += this.move.vel.y * dt;
    resolveCircleVsWalls(this.pos, this.move.vel, PLAYER_RADIUS, this.walls);

    const res = this.world.step(
      { pos: this.pos, vel: this.move.vel, heading: this.move.heading },
      this.scoop,
      this.run,
      this.walls,
      collectConfig,
      dt,
      collectConfig.particlesPerStep,
    );
    this.erasing = res.noise;

    this.stats.speed = length(this.move.vel);
    this.stats.input = length(input);
    this.stats.mass = mass;
    this.stats.drift = this.move.drift;
    this.stats.noise = res.noise;
    this.stats.pieces = this.world.objects.length;
    const remaining = this.world.objects.reduce((s, o) => s + o.mask.remaining, 0);
    let total = 0;
    for (const r of this.rootArts.values()) total += r.totalOpaque;
    this.stats.progress = total > 0 ? (1 - remaining / total) * 100 : 100;
  }
}
