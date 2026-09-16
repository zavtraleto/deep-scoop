import * as THREE from 'three';
import type { mapConfig } from '../core/config';
import type { Vec2 } from '../math/vec2';
import { HIDDEN, type MapKnowledge } from './mapKnowledge';

type MapLook = typeof mapConfig;

const MAX_BLIPS = 512;

/** Общий кусок шейдера: карта прозрачнее у персонажа и ярче к краям экрана. */
const vignetteGlsl = /* glsl */ `
  uniform vec2 uPlayerPx;
  uniform float uShortPx;
  uniform float uClear;
  uniform float uFull;
  uniform float uCenterK;
  float vignette() {
    float d = length(gl_FragCoord.xy - uPlayerPx) / uShortPx;
    return mix(uCenterK, 1.0, smoothstep(uClear, uFull, d));
  }
`;

const vignetteUniforms = () => ({
  uPlayerPx: { value: new THREE.Vector2() },
  uShortPx: { value: 1 },
  uClear: { value: 0.06 },
  uFull: { value: 0.45 },
  uCenterK: { value: 0.12 },
});

/**
 * Карта во весь экран поверх игры — «двойная экспозиция». Своя ортографическая камера охватывает
 * в scale раз больше мира и стоит так, что персонаж на карте всегда совпадает с персонажем в игре
 * (решение пользователя). Контуры открытых стен — тонкие белые линии постоянной толщины, точки
 * предметов и врагов, метка игрока. Фронт развёртки не рисуется: карта просто обновляется.
 * Всё аддитивно и полупрозрачно.
 */
export class MinimapView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private readonly lineMaterial: THREE.ShaderMaterial;
  private readonly revealAttr: THREE.BufferAttribute;
  private readonly blipGeometry = new THREE.BufferGeometry();
  private readonly blipPos = new Float32Array(MAX_BLIPS * 3);
  private readonly blipColor = new Float32Array(MAX_BLIPS * 4);
  private readonly blipMaterial: THREE.ShaderMaterial;
  private readonly player: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly itemColor = new THREE.Color();
  private readonly enemyColor = new THREE.Color();

  constructor(private readonly map: MapKnowledge) {
    // Контуры: каждый отрезок — полоса из 4 вершин, раздвигается по нормали в шейдере.
    const segs = map.segments;
    const pos = new Float32Array(segs.length * 4 * 3);
    const normal = new Float32Array(segs.length * 4 * 2);
    const reveal = new Float32Array(segs.length * 4).fill(HIDDEN);
    const index: number[] = [];
    segs.forEach((s, i) => {
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      const ux = (s.bx - s.ax) / len;
      const uy = (s.by - s.ay) / len;
      const ends = [
        [s.ax, s.ay, -1],
        [s.ax, s.ay, 1],
        [s.bx, s.by, -1],
        [s.bx, s.by, 1],
      ];
      ends.forEach(([x, y, side], k) => {
        const v = i * 4 + k;
        pos.set([x, y, 0], v * 3);
        // Нормаль со стороной; концы чуть продлены вдоль отрезка — стыки без щелей.
        const along = k < 2 ? -1 : 1;
        normal.set([-uy * side + ux * along * 0.5, ux * side + uy * along * 0.5], v * 2);
      });
      const b = i * 4;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    });
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lines.setAttribute('aNormal', new THREE.BufferAttribute(normal, 2));
    this.revealAttr = new THREE.BufferAttribute(reveal, 1).setUsage(THREE.DynamicDrawUsage);
    lines.setAttribute('aReveal', this.revealAttr);
    lines.setIndex(index);
    this.lineMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uHalfWidth: { value: 0.1 },
        uOpacity: { value: 0.4 },
        uFlash: { value: 0.6 },
        ...vignetteUniforms(),
      },
      vertexShader: /* glsl */ `
        attribute vec2 aNormal;
        attribute float aReveal;
        uniform float uHalfWidth;
        uniform float uTime;
        varying float vAge;
        void main() {
          vAge = uTime - aReveal;
          vec3 p = position + vec3(aNormal * uHalfWidth, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform float uFlash;
        varying float vAge;
        ${vignetteGlsl}
        void main() {
          if (vAge < 0.0) discard;
          float flash = uFlash > 0.0 ? clamp(1.0 - vAge / uFlash, 0.0, 1.0) : 0.0;
          float a = uOpacity * vignette() + flash * 0.8;
          gl_FragColor = vec4(vec3(1.0) * a, 1.0);
        }
      `,
    });
    const lineMesh = new THREE.Mesh(lines, this.lineMaterial);
    lineMesh.frustumCulled = false;

    // Точки предметов и врагов.
    this.blipGeometry.setAttribute('position', new THREE.BufferAttribute(this.blipPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.blipGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.blipColor, 4).setUsage(THREE.DynamicDrawUsage));
    this.blipMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 7 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        uniform float uSize;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          gl_PointSize = uSize;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.35, 0.55, d);
          float glow = (1.0 - d) * 0.5;
          float a = max(core, glow) * vColor.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb * a, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const blips = new THREE.Points(this.blipGeometry, this.blipMaterial);
    blips.frustumCulled = false;

    // Метка игрока — маленькая стрелка по носу.
    const arrow = new THREE.BufferGeometry();
    arrow.setAttribute('position', new THREE.Float32BufferAttribute([1, 0, 0, -0.7, 0.6, 0, -0.4, 0, 0, 1, 0, 0, -0.4, 0, 0, -0.7, -0.6, 0], 3));
    this.player = new THREE.Mesh(
      arrow,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }),
    );

    lineMesh.renderOrder = 1;
    blips.renderOrder = 2;
    this.player.renderOrder = 3;
    this.scene.add(lineMesh, blips, this.player);
  }

  /** Все отрезки заново (после сброса уровня). */
  refreshAll(): void {
    const r = this.map.revealed;
    const a = this.revealAttr.array as Float32Array;
    for (let i = 0; i < r.length; i++) a.fill(r[i], i * 4, i * 4 + 4);
    this.revealAttr.needsUpdate = true;
    this.map.changed.length = 0;
  }

  /**
   * gameCenter — центр игрового экрана в мире, gameHalfH — половина видимой высоты игры (ед.),
   * playerPx — персонаж на экране (px буфера, y вверх), buffer — размер буфера, pixelRatio — для толщины линий.
   */
  update(opts: {
    look: MapLook;
    now: number;
    gameCenter: Vec2;
    gameHalfH: number;
    aspect: number;
    player: Vec2;
    heading: number;
    playerPx: Vec2;
    buffer: THREE.Vector2;
    pixelRatio: number;
  }): void {
    const { look, now, buffer } = opts;
    this.scene.visible = look.show;
    if (!look.show) return;

    // Камера карты. Точка мира p на карте: (p − C) / (s·h), в игре: (p − G) / h. Чтобы персонаж P
    // совпадал, C = P − s·(P − G).
    const s = look.scale;
    const P = opts.player;
    const G = opts.gameCenter;
    const center = { x: P.x - s * (P.x - G.x), y: P.y - s * (P.y - G.y) };
    const halfH = opts.gameHalfH * s;
    const halfW = halfH * opts.aspect;
    const cam = this.camera;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.position.set(center.x, center.y, 5);
    cam.updateProjectionMatrix();
    const worldPerPx = (2 * halfH) / Math.max(1, buffer.y);

    // Новые открытые отрезки.
    const changed = this.map.changed;
    if (changed.length > 0) {
      const a = this.revealAttr.array as Float32Array;
      for (const i of changed) a.fill(this.map.revealed[i], i * 4, i * 4 + 4);
      this.revealAttr.needsUpdate = true;
      changed.length = 0;
    }

    {
      const u = this.lineMaterial.uniforms;
      u.uPlayerPx.value.set(opts.playerPx.x, opts.playerPx.y);
      u.uShortPx.value = Math.min(buffer.x, buffer.y);
      u.uClear.value = look.clearRadius;
      u.uFull.value = look.fullRadius;
      u.uCenterK.value = look.centerOpacity;
    }
    const lu = this.lineMaterial.uniforms;
    lu.uTime.value = now;
    lu.uHalfWidth.value = look.lineWidth * opts.pixelRatio * 0.5 * worldPerPx;
    lu.uOpacity.value = look.opacity;
    lu.uFlash.value = look.flashTime;

    // Точки: вспышка при засечке; враг гаснет за enemyLife, предмет остаётся ровным.
    this.itemColor.set(look.itemColor);
    this.enemyColor.set(look.enemyColor);
    let n = 0;
    for (const b of this.map.blips.values()) {
      if (n >= MAX_BLIPS) break;
      const age = now - b.time;
      const flash = Math.max(0, 1 - age / look.flashTime);
      const alpha =
        b.kind === 'enemy' ? Math.max(0, 1 - age / look.enemyLife) * 0.9 + flash * 0.3 : 0.7 + flash * 0.3;
      const c = b.kind === 'enemy' ? this.enemyColor : this.itemColor;
      this.blipPos.set([b.pos.x, b.pos.y, 0], n * 3);
      this.blipColor.set([c.r, c.g, c.b, alpha], n * 4);
      n++;
    }
    this.blipGeometry.setDrawRange(0, n);
    this.blipGeometry.attributes.position.needsUpdate = true;
    this.blipGeometry.attributes.aColor.needsUpdate = true;
    this.blipMaterial.uniforms.uSize.value = look.blipSize * opts.pixelRatio;

    const arrowSize = 6 * opts.pixelRatio * worldPerPx;
    this.player.position.set(opts.player.x, opts.player.y, 0);
    this.player.rotation.z = opts.heading;
    this.player.scale.setScalar(arrowSize);
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.scene.visible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
