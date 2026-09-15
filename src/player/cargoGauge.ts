import * as THREE from 'three';
import { damp } from '../math/vec2';

const RADIUS = 0.2;
/** Смещение камеры груза от центра существа в локальных координатах спрайта (назад и чуть вниз от глаза). */
const LOCAL_OFFSET = { x: -0.1, y: -0.06 };

/**
 * §14: груз — шкала заполнения внутренней камеры существа. Круглая камера в теле,
 * уровень «жидкости» всегда горизонтален в мире и чуть колышется. Полная камера пульсирует.
 */
export class CargoGauge {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private shownFill = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLevel: { value: -1 },
        uTime: { value: 0 },
        uFull: { value: 0 },
        uLiquid: { value: new THREE.Color('#ff7fd0') },
        uRim: { value: new THREE.Color('#3a5373') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = position.xy / ${RADIUS.toFixed(3)};
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLevel;
        uniform float uTime;
        uniform float uFull;
        uniform vec3 uLiquid;
        uniform vec3 uRim;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          if (r > 1.0) discard;
          float wave = sin(vP.x * 5.0 + uTime * 4.0) * 0.06;
          float liquid = step(vP.y, uLevel + wave * step(-0.99, uLevel));
          float rim = smoothstep(0.78, 0.95, r);
          vec3 inside = mix(vec3(0.82, 0.9, 0.97), uLiquid * (1.0 + 0.4 * uFull * (0.5 + 0.5 * sin(uTime * 8.0))), liquid);
          vec3 color = mix(inside, uRim, rim);
          gl_FragColor = vec4(color, 0.92);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 32), this.material);
    this.mesh.position.z = 0.06;
  }

  /** Высота уровня (−1..1 от центра), при которой сегмент круга занимает долю fill площади. */
  private static levelForFill(fill: number): number {
    if (fill <= 0) return -1.01;
    if (fill >= 1) return 1.01;
    let lo = -1;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const h = (lo + hi) / 2;
      // Площадь части единичного круга ниже y = h, делённая на π.
      const area = (h * Math.sqrt(1 - h * h) + Math.asin(h) + Math.PI / 2) / Math.PI;
      if (area < fill) lo = h;
      else hi = h;
    }
    return (lo + hi) / 2;
  }

  update(x: number, y: number, heading: number, fill: number, time: number, dt: number): void {
    this.shownFill += (fill - this.shownFill) * damp(8, dt);
    const flip = Math.cos(heading) < 0 ? -1 : 1; // спрайт отражается при движении влево
    const ox = LOCAL_OFFSET.x;
    const oy = LOCAL_OFFSET.y * flip;
    this.mesh.position.x = x + ox * Math.cos(heading) - oy * Math.sin(heading);
    this.mesh.position.y = y + ox * Math.sin(heading) + oy * Math.cos(heading);
    this.material.uniforms.uLevel.value = CargoGauge.levelForFill(this.shownFill);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uFull.value = fill >= 0.999 ? 1 : 0;
  }
}
