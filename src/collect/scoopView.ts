import * as THREE from 'three';
import type { ScoopParams } from './scoop';
import { damp } from '../math/vec2';

/**
 * Ковш на экране: полупрозрачное поле перед движением с яркой передней кромкой.
 * Пока ковш стирает (шумит), поле разгорается.
 */
export class ScoopView {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private glow = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color('#9ee9ff') },
        uGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGlow;
        varying vec2 vUv;
        void main() {
          // vUv.x — вдоль движения (1 — передний край), vUv.y — поперёк.
          float across = 1.0 - pow(abs(vUv.y * 2.0 - 1.0), 4.0);
          float body = vUv.x * vUv.x * 0.35;
          float edge = smoothstep(0.78, 1.0, vUv.x);
          float a = (body + edge * 0.65) * across * (0.35 + 0.65 * uGlow);
          gl_FragColor = vec4(uColor * (1.0 + uGlow * 0.6), a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.position.z = 0.03;
  }

  update(x: number, y: number, angle: number, erasing: boolean, p: ScoopParams, dt: number): void {
    this.glow += ((erasing ? 1 : 0) - this.glow) * damp(erasing ? 20 : 6, dt);
    this.material.uniforms.uGlow.value = this.glow;
    const center = p.offset + p.depth / 2;
    this.mesh.position.x = x + Math.cos(angle) * center;
    this.mesh.position.y = y + Math.sin(angle) * center;
    this.mesh.rotation.z = angle;
    this.mesh.scale.set(p.depth, p.width, 1);
  }
}
