import * as THREE from 'three';
import {
  cargoConfig,
  collectConfig,
  debugConfig,
  enemyConfig,
  enemyLook,
  mapConfig,
  movementConfig,
  physicsConfig,
  PLAYER_RADIUS,
  visionConfig,
} from './config';
import { CollectWorld } from '../collect/collectWorld';
import type { Cargo } from '../collect/collector';
import { EraseParticles } from '../collect/eraseParticles';
import type { MemoryObject, ObjectSample } from '../collect/memoryObject';
import { MemoryObjectView } from '../collect/memoryObjectView';
import { pickArt } from '../collect/artLibrary';
import { buildObject, type CanvasArt, type CanvasArtLibrary, type ObjectArt } from '../collect/objectArt';
import { createScoopState, type ScoopState } from '../collect/scoop';
import { ScoopView } from '../collect/scoopView';
import { FpsMeter } from '../debug/fpsMeter';
import { createTuningPanel, type TuningRun, type TuningStats } from '../debug/tuning';
import { Input } from '../input/input';
import { angleDelta, clamp, length, type Vec2 } from '../math/vec2';
import { EchoPulse } from '../echo/echoPulse';
import { EchoView } from '../echo/echoView';
import { FogView } from '../echo/fogView';
import { castVisibility, isVisible } from '../echo/light';
import { EnemyDebug } from '../enemies/enemyDebug';
import { EnemySystem } from '../enemies/enemySystem';
import { EnemyView } from '../enemies/enemyView';
import { enemyGrid, NavGrid } from '../enemies/navGrid';
import { MapKnowledge, type Tracked } from '../minimap/mapKnowledge';
import { MinimapView } from '../minimap/minimapView';
import { LightGlowView } from '../echo/lightGlowView';
import { LightMaskView } from '../echo/lightMaskView';
import { MEMORY_LAYER, MemoryView } from '../echo/memoryView';
import { createRecollection, pointLit, updateRecollection, type Recollection, type Sight } from '../echo/sight';
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

  // Видимость: свет, эхо, туман.
  private readonly vision: VisibilityMap;
  private readonly echo = new EchoPulse(visionConfig.echo);
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

  // Враги (этап 4).
  private readonly enemies: EnemySystem;
  private readonly enemyView: EnemyView;
  private readonly enemyDebug = new EnemyDebug();
  /** Сколько осталось до сброса после поимки, с; < 0 — игрок жив. */
  private deathTimer = -1;

  // Карта во весь экран (решение пользователя).
  private readonly mapKnowledge: MapKnowledge;
  private readonly minimap: MinimapView;
  private readonly tracked: Tracked[] = [];

  // Сбор и парящие объекты.
  private readonly world = new CollectWorld();
  private readonly placements: ObjectPlacement[];
  private readonly rootArts = new Map<number, RootArt>();
  /** Одна текстура на картинку: её делят все экземпляры и все куски. */
  private readonly artTextures = new Map<CanvasArt, THREE.Texture>();
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

  constructor(
    private readonly container: HTMLElement,
    private readonly arts: CanvasArtLibrary,
  ) {
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
    this.vision = new VisibilityMap(map.grid.width, map.grid.height);
    this.fog = new FogView(this.vision, this.lightMask.target.texture, this.memory.texture);
    this.lightGlow = new LightGlowView(this.fog.mesh.geometry, this.lightMask.target.texture);
    this.scene.add(this.fog.mesh, this.lightGlow.mesh, this.echoView.group, this.layoutDebug.group);
    this.placements = map.objects;
    this.spawnObjects();

    // Враги ходят по копии карты с закрытой базой, видят — по настоящим стенам.
    const eg = enemyGrid(map.grid, map.enemyBlocked);
    this.enemies = new EnemySystem(map.enemies, new NavGrid(eg), eg.buildWalls(), this.walls, enemyConfig);
    this.enemyView = new EnemyView(this.enemies.enemies, enemyConfig.radius);
    this.scene.add(this.enemyView.group, this.enemyDebug.lines);

    this.mapKnowledge = new MapKnowledge(this.walls);
    this.minimap = new MinimapView(this.mapKnowledge);

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
        this.vision.reset();
        this.echo.reset();
        this.enemies.reset();
        this.enemyView.clearMarkers();
        this.mapKnowledge.reset();
        this.minimap.refreshAll();
        this.deathTimer = -1;
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
    this.rootArts.clear();
    for (const { cls, center, key, art } of this.placements) {
      const source = pickArt(this.arts[cls], key, art);
      if (!source) continue;
      const built = buildObject(center, source, collectConfig.classes, PLAYER_RADIUS * 2, collectConfig.maskPixelsPerUnit);
      const texture = this.artTexture(source);
      this.rootArts.set(built.object.root.id, { art: built.art, texture, totalOpaque: built.object.root.totalOpaque });
      this.world.add(built.object);
    }
  }

  private artTexture(source: CanvasArt): THREE.Texture {
    let texture = this.artTextures.get(source);
    if (!texture) {
      texture = new THREE.CanvasTexture(source.image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      this.artTextures.set(source, texture);
    }
    return texture;
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

    this.enemyView.update(
      this.enemies.enemies,
      (_e, p) => debugConfig.showEnemies || pointLit(p, sight),
      alpha,
      this.time,
      dt,
      enemyLook.markerTime,
    );
    this.enemyDebug.update(this.enemies.enemies, debugConfig.visible && debugConfig.showEnemies, enemyConfig.sightRadius);

    this.sprite.update(x, y, heading);
    // Поимка: существо сжимается и гаснет, потом уровень сбрасывается.
    const dying = this.deathTimer >= 0 ? 1 - this.deathTimer / enemyLook.deathTime : 0;
    this.sprite.mesh.scale.x = 1 - dying;
    this.sprite.mesh.scale.y *= 1 - dying;
    this.sprite.mesh.rotation.z += dying * dying * 6;
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

    const camPos = this.cam.camera.position;
    const playerNdc = new THREE.Vector3(x, y, 0).project(this.cam.camera);
    this.minimap.update({
      look: mapConfig,
      now: this.simTime,
      gameCenter: { x: camPos.x, y: camPos.y },
      gameHalfH: camPos.z * Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2),
      aspect: this.cam.camera.aspect,
      player,
      heading,
      playerPx: { x: (playerNdc.x * 0.5 + 0.5) * this.drawingBuffer.x, y: (playerNdc.y * 0.5 + 0.5) * this.drawingBuffer.y },
      buffer: this.drawingBuffer,
      pixelRatio: this.renderer.getPixelRatio(),
    });
    this.minimap.render(this.renderer);
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

  /** Карта: контуры — клетки, увиденные игроком; развёртка сквозь стены — только точки. */
  private stepMap() {
    for (const i of this.vision.fresh) this.mapKnowledge.revealCell(i, this.simTime);
    this.vision.fresh.length = 0;
    const t = this.tracked;
    t.length = 0;
    if (this.mapKnowledge.sweeping > 0) {
      for (const o of this.world.objects) t.push({ key: o, kind: 'item', pos: o.body.pos });
      for (const e of this.enemies.enemies) t.push({ key: e, kind: 'enemy', pos: e.pos });
    }
    this.mapKnowledge.step(this.simTime, visionConfig.echo.speed, mapConfig.radius, t, mapConfig.enemyLife);
  }

  private stepEnemies(dt: number, noisy: boolean) {
    const alive = this.deathTimer < 0;
    this.enemies.step(dt, {
      player: this.pos,
      playerVel: this.move.vel,
      playerRadius: PLAYER_RADIUS,
      noisy: alive && noisy,
      cargoRatio: this.run.cargo / this.run.cargoMax,
    });
    // Маркер ставим, только если враг был в поле зрения волны: сквозь стены игрок его не «видит».
    for (const ping of this.enemies.pings) {
      if (this.echo.rings.some((r) => isVisible(r.poly, ping.pos))) this.enemyView.mark(ping.pos, enemyLook.markerTime);
    }
    this.enemies.pings.length = 0;

    if (alive && this.enemies.caught && !debugConfig.immortal) {
      this.deathTimer = enemyLook.deathTime;
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2;
        const from = { x: this.pos.x + Math.cos(a) * 0.3, y: this.pos.y + Math.sin(a) * 0.3 };
        this.particles.spawn(from, this.pos, 255, 110, 125, false);
      }
    }
    if (!alive) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.run.resetLevel();
    }
  }

  private fixedUpdate(dt: number) {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevHeading = this.move.heading;
    this.prevScoopAngle = this.scoop.angle;

    const dying = this.deathTimer >= 0;
    const input = dying
      ? { x: 0, y: 0 }
      : this.input.vector({
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
    if (this.echo.firedThisStep) {
      this.echoView.pulse(1);
      this.enemies.pulse(this.pos, this.move.vel, visionConfig.echo.speed);
      this.mapKnowledge.fire(this.pos, this.simTime);
    }
    this.stepEnemies(dt, res.noise);
    this.stepMap();
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
