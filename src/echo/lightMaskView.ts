import * as THREE from 'three';
import type { EchoParams, EchoRing } from './echoPulse';
import type { LightParams, VisibilityPolygon } from './light';

const MAX_VERTS = 4096;

/**
 * Маска света игрока: многоугольник видимости (веером треугольников) рисуется в отдельную текстуру
 * в пространстве экрана. R — ореол вокруг существа, G — луч-прожектор, оба с мягкими краями.
 * B — свечение за фронтом эха: считается попиксельно по расстоянию до точки импульса и гаснет
 * за glow секунд после прохода фронта, в пределах видимости точки импульса (без ячеек).
 * Туман и тёплый подсвет читают эту текстуру.
 */
export class LightMaskView {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_VERTS * 3);
  private readonly material: THREE.ShaderMaterial;
  private readonly echoMeshes = new Map<EchoRing, THREE.Mesh>();

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uOrigin: { value: new THREE.Vector2() },
        uHeading: { value: 0 },
        uRadius: { value: 4 },
        uConeRange: { value: 8 },
        uConeHalf: { value: 0.5 },
        uSoftness: { value: 0.35 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vWorld = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Та же формула, что lightStrength() в light.ts.
      fragmentShader: /* glsl */ `
        uniform vec2 uOrigin;
        uniform float uHeading;
        uniform float uRadius;
        uniform float uConeRange;
        uniform float uConeHalf;
        uniform float uSoftness;
        varying vec2 vWorld;
        const float PI = 3.14159265;
        void main() {
          vec2 d = vWorld - uOrigin;
          float dist = length(d);
          float circle = 1.0 - smoothstep(uRadius * (1.0 - uSoftness), uRadius, dist);
          float off = abs(mod(atan(d.y, d.x) - uHeading + PI, 2.0 * PI) - PI);
          float across = 1.0 - smoothstep(uConeHalf * (1.0 - uSoftness), uConeHalf, off);
          float along = 1.0 - smoothstep(uConeRange * (1.0 - uSoftness), uConeRange, dist);
          gl_FragColor = vec4(circle, across * along, 0.0, 1.0);
        }
      `,
    });
    // Свет рисуется первым и затирает кадр; свечение эха добавляется поверх в канал B.
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
  }

  private echoMesh(ring: EchoRing): THREE.Mesh {
    const existing = this.echoMeshes.get(ring);
    if (existing) return existing;
    const { origin, angles, radii } = ring.poly;
    const pos: number[] = [];
    for (let i = 0; i < angles.length; i++) {
      const j = (i + 1) % angles.length;
      pos.push(
        origin.x,
        origin.y,
        0,
        origin.x + Math.cos(angles[i]) * radii[i],
        origin.y + Math.sin(angles[i]) * radii[i],
        0,
        origin.x + Math.cos(angles[j]) * radii[j],
        origin.y + Math.sin(angles[j]) * radii[j],
        0,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOrigin: { value: new THREE.Vector2(origin.x, origin.y) },
        uAge: { value: 0 },
        uSpeed: { value: 1 },
        uRadius: { value: 1 },
        uGlow: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vWorld = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec2 uOrigin;
        uniform float uAge;
        uniform float uSpeed;
        uniform float uRadius;
        uniform float uGlow;
        varying vec2 vWorld;
        void main() {
          float d = distance(vWorld, uOrigin);
          float front = min(uAge * uSpeed, uRadius);
          // Мягкий край фронта, чтобы свечение не начиналось ступенькой.
          float reached = 1.0 - smoothstep(front - 0.3, front, d);
          float passed = uAge - d / uSpeed;
          float glow = clamp(1.0 - passed / uGlow, 0.0, 1.0) * reached;
          gl_FragColor = vec4(0.0, 0.0, glow, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.echoMeshes.set(ring, mesh);
    return mesh;
  }

  /** Обновить свечение эха: новые кольца добавить, догоревшие убрать. */
  private syncEcho(rings: readonly EchoRing[], p: EchoParams): void {
    for (const ring of rings) {
      const u = (this.echoMesh(ring).material as THREE.ShaderMaterial).uniforms;
      u.uAge.value = ring.age;
      u.uSpeed.value = p.speed;
      u.uRadius.value = p.radius;
      u.uGlow.value = p.glow;
    }
    for (const [ring, mesh] of this.echoMeshes) {
      if (rings.includes(ring)) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.echoMeshes.delete(ring);
    }
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }

  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    poly: VisibilityPolygon,
    heading: number,
    p: LightParams,
    rings: readonly EchoRing[],
    echo: EchoParams,
  ): void {
    this.syncEcho(rings, echo);
    const { origin, angles, radii } = poly;
    const n = Math.min(angles.length, Math.floor(MAX_VERTS / 3));
    let k = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % angles.length;
      this.positions.set(
        [
          origin.x,
          origin.y,
          0,
          origin.x + Math.cos(angles[i]) * radii[i],
          origin.y + Math.sin(angles[i]) * radii[i],
          0,
          origin.x + Math.cos(angles[j]) * radii[j],
          origin.y + Math.sin(angles[j]) * radii[j],
          0,
        ],
        k,
      );
      k += 9;
    }
    this.geometry.setDrawRange(0, n * 3);
    this.geometry.attributes.position.needsUpdate = true;

    const u = this.material.uniforms;
    u.uOrigin.value.set(origin.x, origin.y);
    u.uHeading.value = heading;
    u.uRadius.value = p.radius;
    u.uConeRange.value = p.coneRange;
    u.uConeHalf.value = (p.coneAngleDeg * Math.PI) / 360;
    u.uSoftness.value = p.softness;

    const prev = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(prevColor, prevAlpha);
  }
}
