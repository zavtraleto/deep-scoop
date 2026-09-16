import * as THREE from 'three';
import { damp, type Vec2 } from '../math/vec2';
import type { EchoParams, EchoRing } from './echoPulse';

/**
 * Эхо на экране (§9.1, §14): тонкие кольца импульсов и кольцо заряда вокруг игрока.
 * Кольцо импульса рисуется на многоугольнике видимости точки импульса — за стены не заходит.
 * Кольцо заряда заполняется по часовой стрелке от верха; вспыхивает при импульсе.
 */
export class EchoView {
  readonly group = new THREE.Group();
  private readonly rings = new Map<EchoRing, THREE.Mesh>();
  private readonly charge: THREE.Mesh;
  private readonly chargeMat: THREE.ShaderMaterial;
  private flash = 0;

  constructor() {
    this.chargeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCharge: { value: 0 },
        uFlash: { value: 0 },
        uColor: { value: new THREE.Color('#8fe6ff') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uCharge;
        uniform float uFlash;
        uniform vec3 uColor;
        varying vec2 vLocal;
        const float PI = 3.14159265;
        void main() {
          float d = length(vLocal);
          float band = smoothstep(0.78, 0.8, d) * (1.0 - smoothstep(0.86, 0.88, d));
          if (band < 0.01) discard;
          // Угол от верха по часовой: 0..1.
          float a = fract(atan(vLocal.x, vLocal.y) / (2.0 * PI) + 1.0);
          float filled = step(a, uCharge);
          float alpha = band * (0.12 + filled * 0.5 + uFlash * 0.4);
          gl_FragColor = vec4(uColor, alpha);
          #include <colorspace_fragment>
        }
      `,
    });
    this.charge = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.chargeMat);
    this.charge.renderOrder = 22;
    this.group.add(this.charge);
    this.group.position.z = 0.05;
  }

  pulse(amount = 1): void {
    this.flash = Math.min(1, this.flash + amount);
  }

  private createRing(ring: EchoRing): THREE.Mesh {
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
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uOrigin: { value: new THREE.Vector2(origin.x, origin.y) },
        uRadius: { value: 0 },
        uMax: { value: 16 },
        uColor: { value: new THREE.Color('#8fe6ff') },
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
        uniform float uRadius;
        uniform float uMax;
        uniform vec3 uColor;
        varying vec2 vWorld;
        void main() {
          float d = distance(vWorld, uOrigin);
          float line = 1.0 - smoothstep(0.03, 0.09, abs(d - uRadius));
          float fade = 1.0 - smoothstep(0.7, 1.0, uRadius / uMax);
          float a = line * fade * 0.8;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 15;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  update(player: Vec2, charge: number, rings: readonly EchoRing[], p: EchoParams, dt: number): void {
    this.flash *= 1 - damp(5, dt);
    this.charge.position.set(player.x, player.y, 0);
    this.chargeMat.uniforms.uCharge.value = charge;
    this.chargeMat.uniforms.uFlash.value = this.flash;

    for (const ring of rings) {
      const mesh = this.rings.get(ring) ?? this.createRing(ring);
      this.rings.set(ring, mesh);
      // Линия фронта видна, пока кольцо расширяется; дальше кольцо живёт только ради свечения.
      mesh.visible = ring.radius < p.radius;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uRadius.value = ring.radius;
      u.uMax.value = p.radius;
    }
    for (const [ring, mesh] of this.rings) {
      if (rings.includes(ring)) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.rings.delete(ring);
    }
  }
}
