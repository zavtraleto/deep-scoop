import * as THREE from 'three';
import { cargoConfig, collectConfig, movementConfig, physicsConfig, PLAYER_RADIUS, visionConfig } from './config';
import { CollectWorld } from '../collect/collectWorld';
import type { Cargo } from '../collect/collector';
import { EraseParticles } from '../collect/eraseParticles';
import type { MemoryObject, ObjectSample } from '../collect/memoryObject';
import { MemoryObjectView } from '../collect/memoryObjectView';
import { buildTelevision, type ObjectArt } from '../collect/objectArt';
import { createScoopState, type ScoopState } from '../collect/scoop';
import { ScoopView } from '../collect/scoopView';
import { FpsMeter } from '../debug/fpsMeter';
import { createTuningPanel, type TuningRun, type TuningStats } from '../debug/tuning';
import { Input } from '../input/input';
import { angleDelta, clamp, length, type Vec2 } from '../math/vec2';
import { EchoPulse } from '../echo/echoPulse';
import { EchoView } from '../echo/echoView';
import { FogView } from '../echo/fogView';
import { castVisibility } from '../echo/light';
import { LightGlowView } from '../echo/lightGlowView';
import { LightMaskView } from '../echo/lightMaskView';
import { MEMORY_LAYER, MemoryView } from '../echo/memoryView';
import { createRecollection, updateRecollection, type Recollection, type Sight } from '../echo/sight';
import { ShardField } from '../echo/shards';
import { ShardView } from '../echo/shardView';
import { VisibilityMap } from '../echo/visibility';
import { buildChunk, type ObjectPlacement } from '../gen/buildChunk';
import { stage3Layout } from '../gen/handLayouts';
import { LayoutDebug } from '../gen/layoutDebug';
import { CargoGauge } from '../player/cargoGauge';
import { createMovementState, massFor, stepMovement, type MovementState } from '../player/movement';
import { PlayerSprite } from '../player/playerSprite';
import { StickZonesDebug } from '../player/stickZonesDebug';
import { FollowCamera } from '../render/followCamera';
import { resolveCircleVsWalls } from '../world/collision';
import type { WallIndex } from '../world/grid';
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
  private readonly layoutDebug: LayoutDebug;

  // Видимость: свет, эхо, осколки, туман.
  private readonly vision: VisibilityMap;
  private readonly echo = new EchoPulse(visionConfig.echo);
  private readonly shards: ShardField;
  private readonly shardView: ShardView;
  private readonly lightMask = new LightMaskView();
  private readonly fog: FogView;
  private readonly lightGlow: LightGlowView;
  private readonly memory = new MemoryView();
  private readonly recollections = new Map<MemoryObject, Recollection>();
  private readonly echoView = new EchoView();
  private exploreTimer = 0;
  private simTime = 0;
  private readonly spawn: Vec2;
  private readonly drawingBuffer = new THREE.Vector2();

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
  private readonly fps = new FpsMeter();
  private accumulator = 0;
  private lastTime = -1;
  private time = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.scene.background = palette.wall;

    const map = buildChunk(stage3Layout());
    this.walls = map.grid.buildWalls();
    const worldMesh = buildWorldMesh(map.grid, this.walls);
    worldMesh.traverse((o) => o.layers.enable(MEMORY_LAYER)); // пол и стены есть и в памяти
    this.scene.add(worldMesh);
    this.layoutDebug = new LayoutDebug(map);
    this.shards = new ShardField(map.shards);
    this.shardView = new ShardView(this.shards);
    this.vision = new VisibilityMap(map.grid.width, map.grid.height);
    this.fog = new FogView(this.vision, this.lightMask.target.texture, this.memory.texture);
    this.lightGlow = new LightGlowView(this.fog.mesh.geometry, this.lightMask.target.texture);
    this.scene.add(this.shardView.mesh, this.shardView.ghost, this.fog.mesh, this.lightGlow.mesh, this.echoView.group, this.layoutDebug.group);
    this.placements = map.objects;
    this.spawnObjects();

    this.scene.add(this.scoopView.mesh, this.sprite.mesh, this.gauge.mesh, this.particles.points, this.zonesDebug.group);
    // Всё, что про игрока, и отладка рисуются поверх тумана.
    this.scoopView.mesh.renderOrder = 20;
    this.sprite.mesh.renderOrder = 21;
    this.gauge.mesh.renderOrder = 22;
    this.particles.points.renderOrder = 23;
    this.zonesDebug.group.traverse((o) => {
      o.renderOrder = 30;
    });
    this.layoutDebug.group.traverse((o) => {
      o.renderOrder = 30;
    });

    this.spawn = { ...map.spawn };
    this.pos = { ...map.spawn };
    this.prevPos = { ...map.spawn };
    this.cam.snapTo(this.pos);

    this.run = {
      cargo: 0,
      cargoMax: cargoConfig.cargoMax,
      resetLevel: () => {
        this.world.clear();
        this.syncObjectViews(); // убрать старые виды, пока их текстуры ещё живы
        this.spawnObjects();
        this.run.cargo = 0;
        this.shards.reset();
        this.shardView.reset();
        this.vision.reset();
        this.echo.reset();
        Object.assign(this.pos, this.spawn);
        Object.assign(this.prevPos, this.spawn);
        this.move.vel.x = this.move.vel.y = 0;
        this.cam.snapTo(this.pos);
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
    this.renderer.getDrawingBufferSize(this.drawingBuffer);
    this.lightMask.setSize(this.drawingBuffer.x, this.drawingBuffer.y);
    this.memory.setSize(this.drawingBuffer.x, this.drawingBuffer.y);
  };

  private frame = (timeMs: number) => {
    const now = timeMs / 1000;
    const dt = this.lastTime < 0 ? 0 : clamp(now - this.lastTime, 0, 0.1);
    // Настоящая длительность кадра (без ограничения сверху) — для счётчика.
    if (this.lastTime >= 0) this.fps.tick(now - this.lastTime);
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

    // Что игрок видит в этом кадре — для слепков памяти и маски света.
    const light = castVisibility(player, heading, this.walls, visionConfig.light);
    const sight: Sight = {
      light,
      heading,
      lightParams: visionConfig.light,
      rings: this.echo.rings,
      echo: visionConfig.echo,
    };

    this.layoutDebug.update();
    this.shardView.update(this.time, sight);
    this.echoView.update(player, this.echo.charge, this.echo.rings, visionConfig.echo, dt);
    this.syncObjectViews();
    for (const [object, view] of this.views) {
      view.update(this.time, alpha, dt);
      const rec = this.recollections.get(object)!;
      const p = view.mesh.position;
      updateRecollection(rec, { pos: p, angle: view.mesh.rotation.z, radius: view.sightRadius, exists: true }, sight);
      view.updateGhost(rec);
    }
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

    // Свет считаем в кадре по интерполированному положению — тени не дёргаются.
    this.cam.camera.updateMatrixWorld();
    this.memory.render(this.renderer, this.scene, this.cam.camera, visionConfig.fog.memoryBlur);
    this.lightMask.render(
      this.renderer,
      this.cam.camera,
      light,
      heading,
      visionConfig.light,
      this.echo.rings,
      visionConfig.echo,
    );
    this.fog.update(this.drawingBuffer, this.time);
    this.lightGlow.update(this.drawingBuffer);
    this.renderer.render(this.scene, this.cam.camera);
  };

  /** Создать и убрать отрисовку по событиям мира: раскол заменяет объект кусками. */
  private syncObjectViews() {
    for (const e of this.world.events) {
      if (e.type === 'removed') {
        this.views.get(e.object)?.dispose();
        this.views.delete(e.object);
        this.recollections.delete(e.object);
        continue;
      }
      const rootArt = this.rootArts.get(e.object.root.id);
      if (!rootArt) continue;
      const view = new MemoryObjectView(e.object, rootArt.texture, e.bySplit ? 1 : 0);
      this.views.set(e.object, view);
      this.recollections.set(e.object, createRecollection());
      this.scene.add(view.mesh, view.ghost);
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

    this.simTime += dt;
    this.echo.step(dt, this.pos, this.vision, this.walls, this.simTime);
    if (this.echo.firedThisStep) this.echoView.pulse(1);
    const picked = this.shards.step(this.pos, dt, visionConfig.shards);
    if (picked > 0) {
      this.echo.boost(picked);
      this.echoView.pulse(0.35);
      for (const i of this.shards.picked) {
        for (let k = 0; k < 3; k++) this.particles.spawn(this.shards.pos[i], this.pos, 160, 240, 255, true);
      }
    }
    this.exploreTimer -= dt;
    if (this.exploreTimer <= 0) {
      this.exploreTimer = 1 / visionConfig.exploreRate;
      const poly = castVisibility(this.pos, this.move.heading, this.walls, visionConfig.light);
      this.vision.exploreByLight(poly, this.move.heading, visionConfig.light);
    }

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
