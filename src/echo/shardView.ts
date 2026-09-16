import * as THREE from 'three';
import { MEMORY_LAYER } from './memoryView';
import { createRecollection, updateRecollection, type Recollection, type Sight } from './sight';
import type { ShardField } from './shards';

/**
 * Осколки памяти (§8) — мелкие светящиеся ромбики, мерцающие каждый в своём ритме.
 * ghost — слепки в слое памяти: где осколки видели в последний раз.
 */
export class ShardView {
  readonly mesh: THREE.InstancedMesh;
  readonly ghost: THREE.InstancedMesh;
  private readonly recollections: Recollection[];
  private readonly material: THREE.ShaderMaterial;

  private readonly matrix = new THREE.Matrix4();

  constructor(private readonly field: ShardField) {
    const positions = field.pos;
    const geometry = new THREE.PlaneGeometry(0.42, 0.42);
    geometry.setAttribute(
      'aPhase',
      new THREE.InstancedBufferAttribute(new Float32Array(positions.map(() => Math.random() * Math.PI * 2)), 1),
    );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#9ff3ff') } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying vec2 vUv;
        varying float vPulse;
        void main() {
          vUv = uv;
          vPulse = 0.65 + 0.35 * sin(uTime * 3.0 + aPhase);
          float bob = sin(uTime * 1.3 + aPhase) * 0.06;
          vec4 p = instanceMatrix * vec4(position, 1.0);
          p.y += bob;
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vPulse;
        void main() {
          vec2 d = abs(vUv - 0.5);
          float diamond = 1.0 - smoothstep(0.18, 0.26, d.x + d.y);
          float glow = smoothstep(0.5, 0.0, length(vUv - 0.5)) * 0.45;
          float a = max(diamond, glow) * vPulse;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * (0.8 + diamond * 0.6), a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, positions.length);
    positions.forEach((p, i) => this.mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, 0)));
    this.mesh.position.z = 0.02;
    this.mesh.frustumCulled = false;

    this.ghost = new THREE.InstancedMesh(geometry, this.material, positions.length);
    this.ghost.position.z = 0.02;
    this.ghost.frustumCulled = false;
    this.ghost.layers.set(MEMORY_LAYER);
    this.recollections = positions.map(() => createRecollection());
  }

  reset(): void {
    for (const r of this.recollections) r.known = false;
  }

  update(time: number, sight: Sight): void {
    this.material.uniforms.uTime.value = time;
    const { pos, alive } = this.field;
    for (let i = 0; i < pos.length; i++) {
      // Подобранный осколок схлопывается в точку.
      const s = alive[i] ? 1 : 0;
      this.matrix.makeScale(s, s, 1).setPosition(pos[i].x, pos[i].y, 0);
      this.mesh.setMatrixAt(i, this.matrix);

      const rec = this.recollections[i];
      updateRecollection(rec, { pos: pos[i], angle: 0, radius: 0.2, exists: alive[i] }, sight);
      const g = rec.known ? 1 : 0;
      this.matrix.makeScale(g, g, 1).setPosition(rec.pos.x, rec.pos.y, 0);
      this.ghost.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ghost.instanceMatrix.needsUpdate = true;
  }
}
