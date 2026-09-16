import * as THREE from 'three';
import type { Enemy } from './enemy';

const MAX_VERTS = 4096;
const CIRCLE_SEGMENTS = 32;

/**
 * Отладка врагов: путь (жёлтый), последняя известная позиция игрока (крест: красный — пульс,
 * оранжевый — шум, белый — видит), цель, радиус прямой видимости.
 */
export class EnemyDebug {
  readonly lines: THREE.LineSegments;
  private readonly pos = new Float32Array(MAX_VERTS * 3);
  private readonly col = new Float32Array(MAX_VERTS * 3);
  private n = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.lines.renderOrder = 30;
    this.lines.frustumCulled = false;
  }

  private seg(ax: number, ay: number, bx: number, by: number, c: THREE.Color) {
    if (this.n + 2 > MAX_VERTS) return;
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      this.pos.set([x, y, 0.05], this.n * 3);
      this.col.set([c.r, c.g, c.b], this.n * 3);
      this.n++;
    }
  }

  private circle(x: number, y: number, r: number, c: THREE.Color) {
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      this.seg(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, c);
    }
  }

  private cross(x: number, y: number, s: number, c: THREE.Color) {
    this.seg(x - s, y - s, x + s, y + s, c);
    this.seg(x - s, y + s, x + s, y - s, c);
  }

  update(enemies: readonly Enemy[], show: boolean, sightRadius: number): void {
    this.lines.visible = show;
    if (!show) return;
    this.n = 0;
    const path = new THREE.Color('#ffd84a');
    const sight = new THREE.Color('#5a6b86');
    const target = new THREE.Color('#7cf0ff');
    const sourceColor = {
      pulse: new THREE.Color('#ff4d5e'),
      noise: new THREE.Color('#ff9a3c'),
      sight: new THREE.Color('#ffffff'),
    };
    for (const e of enemies) {
      this.circle(e.pos.x, e.pos.y, sightRadius, e.sees ? sourceColor.sight : sight);
      let px = e.pos.x;
      let py = e.pos.y;
      for (const p of e.path) {
        this.seg(px, py, p.x, p.y, path);
        px = p.x;
        py = p.y;
      }
      if (e.target) this.circle(e.target.x, e.target.y, 0.35, target);
      if (e.info) this.cross(e.info.pos.x, e.info.pos.y, 0.5, sourceColor[e.info.source]);
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
