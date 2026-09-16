import * as THREE from 'three';
import type { Vec2 } from '../math/vec2';

const MAX = 700;
const LIFE = 1.1; // с, дольше частица не живёт
const ABSORB_RADIUS = 0.3;

/**
 * Частицы стёртой памяти: вылетают из стёртых пикселей цветом картинки и засасываются в существо.
 * Чисто визуальная система, обновляется в кадре, а не в фиксированном шаге.
 */
export class EraseParticles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly vel = new Float32Array(MAX * 2);
  private readonly age = new Float32Array(MAX).fill(LIFE);
  private readonly baseSize = new Float32Array(MAX);
  /** 1 — частица засасывается в существо (груз), 0 — просто разлетается и гаснет (вспышка разреза). */
  private readonly homing = new Uint8Array(MAX);
  private next = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.position.z = 0.045;
  }

  /** color — sRGB 0..255. from — откуда вылетает, player — чтобы разлёт шёл немного от игрока. */
  spawn(from: Vec2, player: Vec2, r: number, g: number, b: number, homing = true): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = from.x;
    this.pos[i * 3 + 1] = from.y;
    this.pos[i * 3 + 2] = 0;
    // Цвет чуть высветлен: это «информация», а не пыль.
    const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).lerp(new THREE.Color(1, 1, 1), 0.25);
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    const away = Math.atan2(from.y - player.y, from.x - player.x) + (Math.random() - 0.5) * 2.2;
    const speed = homing ? 1.5 + Math.random() * 2.5 : 0.3 + Math.random() * 0.9;
    this.homing[i] = homing ? 1 : 0;
    this.vel[i * 2] = Math.cos(away) * speed;
    this.vel[i * 2 + 1] = Math.sin(away) * speed;
    this.age[i] = 0;
    this.baseSize[i] = 0.12 + Math.random() * 0.14;
  }

  update(dt: number, player: Vec2): void {
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const px = this.pos[i * 3];
      const py = this.pos[i * 3 + 1];
      const dx = player.x - px;
      const dy = player.y - py;
      const dist = Math.hypot(dx, dy) || 1e-6;
      if (this.homing[i] && dist < ABSORB_RADIUS) {
        this.age[i] = LIFE;
        this.alpha[i] = 0;
        continue;
      }
      // Сначала разлёт, затем нарастающее притяжение к существу. Искры вспышки не притягиваются.
      const pull = this.homing[i] ? Math.min(1, this.age[i] / 0.25) * 45 : 0;
      const drag = Math.exp(-4 * dt);
      this.vel[i * 2] = this.vel[i * 2] * drag + (dx / dist) * pull * dt;
      this.vel[i * 2 + 1] = this.vel[i * 2 + 1] * drag + (dy / dist) * pull * dt;
      this.pos[i * 3] = px + this.vel[i * 2] * dt;
      this.pos[i * 3 + 1] = py + this.vel[i * 2 + 1] * dt;
      const t = this.age[i] / LIFE;
      this.alpha[i] = Math.min(1, this.age[i] / 0.05) * (1 - t * t);
      this.size[i] = this.homing[i] ? this.baseSize[i] * Math.min(1, dist / 1.2 + 0.35) : this.baseSize[i] * 0.8;
    }
    for (const name of ['position', 'color', 'size', 'alpha']) this.geometry.getAttribute(name).needsUpdate = true;
  }

  /** Масштаб размера точек: пикселей экрана на единицу мира на расстоянии 1. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }
}
