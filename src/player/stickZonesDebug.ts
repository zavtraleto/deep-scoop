import * as THREE from 'three';
import { debugConfig, movementConfig } from '../core/config';
import type { Vec2 } from '../math/vec2';

const INNER = 1.25;
const OUTER = 1.45;
const SEGMENTS = 64;

const colors = {
  turn: new THREE.Color('#5fd4ff'),
  drift: new THREE.Color('#ffb347'),
  rear: new THREE.Color('#ff5a6e'),
  velocity: new THREE.Color('#ffffff'),
};

const flat = (color: THREE.Color, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

/**
 * Отладка модели движения: круг зон стика вокруг игрока, повёрнутый по носу.
 * Голубая дуга — зона поворота (оранжевеет в заносе), красная — задний сектор-тормоз (ярче при торможении).
 * Точка на круге — направление ввода, белая черта снаружи — направление скорости.
 */
export class StickZonesDebug {
  readonly group = new THREE.Group();
  private readonly zones = new THREE.Group();
  private readonly turnMat = flat(colors.turn, 0.35);
  private readonly rearMat = flat(colors.rear, 0.35);
  private readonly turnArc: THREE.Mesh;
  private readonly rearArc: THREE.Mesh;
  private readonly inputDot: THREE.Mesh;
  private readonly velocityTick: THREE.Mesh;
  private builtRearDeg = NaN;

  constructor() {
    this.turnArc = new THREE.Mesh(undefined, this.turnMat);
    this.rearArc = new THREE.Mesh(undefined, this.rearMat);
    // Метка носа — короткая черта в середине зоны поворота.
    const nose = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.06), flat(colors.turn, 0.8));
    nose.position.x = OUTER + 0.14;
    this.zones.add(this.turnArc, this.rearArc, nose);

    this.inputDot = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), flat(colors.turn, 0.95));
    this.velocityTick = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.05), flat(colors.velocity, 0.6));

    this.group.add(this.zones, this.inputDot, this.velocityTick);
    this.group.position.z = 0.04; // под спрайтом игрока
  }

  private rebuild(rearDeg: number) {
    const rear = THREE.MathUtils.degToRad(rearDeg);
    this.turnArc.geometry.dispose();
    this.rearArc.geometry.dispose();
    // Угол 0 — нос. Задний сектор центрирован на π.
    this.turnArc.geometry = new THREE.RingGeometry(INNER, OUTER, SEGMENTS, 1, -(Math.PI - rear / 2), Math.PI * 2 - rear);
    this.rearArc.geometry = new THREE.RingGeometry(INNER, OUTER, SEGMENTS, 1, Math.PI - rear / 2, rear);
    this.builtRearDeg = rearDeg;
  }

  update(x: number, y: number, heading: number, input: Vec2, vel: Vec2, braking: boolean, drift: number): void {
    this.group.visible = debugConfig.visible && debugConfig.showStickZones;
    if (!this.group.visible) return;
    if (movementConfig.rearSectorDeg !== this.builtRearDeg) this.rebuild(movementConfig.rearSectorDeg);

    this.group.position.x = x;
    this.group.position.y = y;
    this.zones.rotation.z = heading;

    this.turnMat.color.copy(colors.turn).lerp(colors.drift, drift);
    this.turnMat.opacity = 0.3 + 0.4 * drift;
    this.rearMat.opacity = braking ? 0.85 : 0.3;

    const strength = Math.hypot(input.x, input.y);
    this.inputDot.visible = strength > 0;
    if (strength > 0) {
      const a = Math.atan2(input.y, input.x);
      const r = (INNER + OUTER) / 2;
      this.inputDot.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.001);
      this.inputDot.scale.setScalar(0.6 + 0.4 * strength);
      (this.inputDot.material as THREE.MeshBasicMaterial).color.copy(braking ? colors.rear : this.turnMat.color);
    }

    const speed = Math.hypot(vel.x, vel.y);
    this.velocityTick.visible = speed > 0.3;
    if (this.velocityTick.visible) {
      const a = Math.atan2(vel.y, vel.x);
      const r = OUTER + 0.35 + 0.15 * (speed / movementConfig.maxSpeed);
      this.velocityTick.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      this.velocityTick.rotation.z = a;
    }
  }
}
