import * as THREE from 'three';
import { cargoConfig, movementConfig, physicsConfig, PLAYER_RADIUS } from './config';
import { createTuningPanel, type TuningStats } from '../debug/tuning';
import { Input } from '../input/input';
import { clamp, length, type Vec2 } from '../math/vec2';
import { createMovementState, massFor, stepMovement, type MovementState } from '../player/movement';
import { PlayerSprite } from '../player/playerSprite';
import { StickZonesDebug } from '../player/stickZonesDebug';
import { FollowCamera } from '../render/followCamera';
import { resolveCircleVsWalls } from '../world/collision';
import type { WallIndex } from '../world/grid';
import { movementTestMap } from '../world/testMaps';
import { buildWorldMesh, palette } from '../world/worldMesh';

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

  private readonly stats: TuningStats = { speed: 0, input: 0, mass: 1, drift: 0 };
  private accumulator = 0;
  private lastTime = -1;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.scene.background = palette.wall;

    const map = movementTestMap();
    this.walls = map.grid.buildWalls();
    this.scene.add(buildWorldMesh(map.grid, this.walls));
    this.scene.add(this.sprite.mesh, this.zonesDebug.group);

    this.pos = { ...map.spawn };
    this.prevPos = { ...map.spawn };
    this.cam.snapTo(this.pos);

    this.input = new Input(container);
    createTuningPanel(this.stats);

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

    this.sprite.update(x, y, heading);
    const m = this.move;
    this.zonesDebug.update(x, y, heading, this.lastInput, m.vel, m.braking, m.drift);
    this.cam.update({ x, y }, this.move.vel, dt);
    this.renderer.render(this.scene, this.cam.camera);
  };

  private fixedUpdate(dt: number) {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevHeading = this.move.heading;

    const input = this.input.vector;
    this.lastInput = input;
    const mass = massFor(cargoConfig.cargo, cargoConfig.cargoMax, movementConfig.baseMass);
    stepMovement(this.move, input, mass, movementConfig, dt);

    this.pos.x += this.move.vel.x * dt;
    this.pos.y += this.move.vel.y * dt;
    resolveCircleVsWalls(this.pos, this.move.vel, PLAYER_RADIUS, this.walls);

    this.stats.speed = length(this.move.vel);
    this.stats.input = length(input);
    this.stats.mass = mass;
    this.stats.drift = this.move.drift;
  }
}
