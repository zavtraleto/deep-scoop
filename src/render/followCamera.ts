import * as THREE from 'three';
import { cameraConfig } from '../core/config';
import { damp, type Vec2 } from '../math/vec2';

/**
 * §15.4: перспективная камера смотрит на игровой слой перпендикулярно, плавно следует за игроком
 * с опережением по направлению движения (по вертикали сильнее). Без вращения.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly pos: Vec2 = { x: 0, y: 0 };
  private readonly lead: Vec2 = { x: 0, y: 0 };
  private aspect = 1;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(cameraConfig.fov, 1, 0.1, 500);
  }

  resize(width: number, height: number): void {
    this.aspect = width / height;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  snapTo(target: Vec2): void {
    this.pos.x = target.x;
    this.pos.y = target.y;
    this.lead.x = this.lead.y = 0;
  }

  update(target: Vec2, vel: Vec2, dt: number): void {
    const c = cameraConfig;
    const leadK = damp(c.leadRate, dt);
    this.lead.x += (vel.x * c.leadTime - this.lead.x) * leadK;
    this.lead.y += (vel.y * c.leadTime * c.leadVerticalScale - this.lead.y) * leadK;

    const followK = damp(c.followRate, dt);
    this.pos.x += (target.x + this.lead.x - this.pos.x) * followK;
    this.pos.y += (target.y + this.lead.y - this.pos.y) * followK;

    if (this.camera.fov !== c.fov) {
      this.camera.fov = c.fov;
      this.camera.updateProjectionMatrix();
    }
    // viewSize — видимый размер по короткой стороне экрана.
    const visibleHeight = this.aspect >= 1 ? c.viewSize : c.viewSize / this.aspect;
    const distance = visibleHeight / 2 / Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
    this.camera.position.set(this.pos.x, this.pos.y, distance);
  }
}
