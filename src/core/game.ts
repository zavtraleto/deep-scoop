import * as THREE from 'three';
import { cargoConfig, collectConfig, movementConfig, physicsConfig, PLAYER_RADIUS } from './config';
import { stepCollect, type Cargo } from '../collect/collector';
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
import { collectTestMap } from '../world/testMaps';
import { buildWorldMesh, palette } from '../world/worldMesh';

interface PlacedObject {
  object: MemoryObject;
  art: ObjectArt;
  view: MemoryObjectView;
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

  // Сбор (этап 2).
  private readonly objects: PlacedObject[];
  private readonly scoop: ScoopState = createScoopState();
  private prevScoopAngle = 0;
  private readonly scoopView = new ScoopView();
  private readonly particles = new EraseParticles();
  private readonly gauge = new CargoGauge();
  private readonly samples: ObjectSample[] = [];
  private erasing = false;
  private readonly run: TuningRun & Cargo;

  private readonly stats: TuningStats = { speed: 0, input: 0, mass: 1, drift: 0, noise: false, progress: 0 };
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

    this.objects = map.objects.map(({ cls, center }) => {
      const built = buildTelevision(center, cls, collectConfig.classes, PLAYER_RADIUS * 2, collectConfig.maskPixelsPerUnit);
      const view = new MemoryObjectView(built.object, built.art);
      this.scene.add(view.mesh);
      return { ...built, view };
    });

    this.scene.add(this.scoopView.mesh, this.sprite.mesh, this.gauge.mesh, this.particles.points, this.zonesDebug.group);

    this.pos = { ...map.spawn };
    this.prevPos = { ...map.spawn };
    this.cam.snapTo(this.pos);

    this.run = {
      cargo: 0,
      cargoMax: cargoConfig.cargoMax,
      resetObjects: () => {
        for (const o of this.objects) o.object.mask.reset();
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

    for (const o of this.objects) o.view.update(this.time);
    this.spawnParticles(player);
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

  private spawnParticles(player: Vec2) {
    for (const s of this.samples) {
      const placed = this.objects.find((o) => o.object === s.object);
      if (!placed) continue;
      const i = (s.py * s.object.mask.width + s.px) * 3;
      const c = placed.art.colors;
      this.particles.spawn(s, player, c[i], c[i + 1], c[i + 2]);
    }
    this.samples.length = 0;
  }

  private fixedUpdate(dt: number) {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevHeading = this.move.heading;
    this.prevScoopAngle = this.scoop.angle;

    const input = this.input.vector;
    this.lastInput = input;
    this.run.cargoMax = cargoConfig.cargoMax;
    const mass = massFor(this.run.cargo, this.run.cargoMax, movementConfig.baseMass);
    stepMovement(this.move, input, mass, movementConfig, dt);

    this.pos.x += this.move.vel.x * dt;
    this.pos.y += this.move.vel.y * dt;
    resolveCircleVsWalls(this.pos, this.move.vel, PLAYER_RADIUS, this.walls);

    const res = stepCollect(
      this.scoop,
      this.pos,
      this.move.vel,
      this.move.heading,
      this.objects.map((o) => o.object),
      this.run,
      collectConfig.scoop,
      dt,
      this.samples,
      this.samples.length + collectConfig.particlesPerStep,
    );
    this.erasing = res.noise;

    this.stats.speed = length(this.move.vel);
    this.stats.input = length(input);
    this.stats.mass = mass;
    this.stats.drift = this.move.drift;
    this.stats.noise = res.noise;
    this.stats.progress = (this.objects[0]?.object.progress ?? 0) * 100;
  }
}
