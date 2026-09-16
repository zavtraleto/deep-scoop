import * as THREE from 'three';
import { MEMORY_LAYER } from '../echo/memoryView';
import type { Recollection } from '../echo/sight';
import { angleDelta, damp } from '../math/vec2';
import type { MemoryObject } from './memoryObject';

/**
 * Отрисовка Memory Object или его куска: маска стирания — альфа спрайта (§6.3), край стёртой области
 * светится. Куски одного объекта делят одну текстуру картинки корня, у каждого своя маска
 * и своё окно UV в картинке. Вспышка (flash) подсвечивает края сразу после раскола.
 * ghost — слепок в слое памяти: там, где объект видели в последний раз.
 */
export class MemoryObjectView {
  readonly mesh: THREE.Mesh;
  readonly ghost: THREE.Mesh;
  private readonly maskTexture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private flash: number;

  constructor(
    private readonly object: MemoryObject,
    artTexture: THREE.Texture,
    flash = 0,
  ) {
    this.flash = flash;
    const { mask, root } = object;
    this.maskTexture = new THREE.DataTexture(mask.erased, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTexture.unpackAlignment = 1; // ширина маски не кратна 4
    this.maskTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.minFilter = THREE.LinearFilter;
    this.maskTexture.needsUpdate = true;
    mask.dirty = false;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: artTexture },
        uMask: { value: this.maskTexture },
        uArtOffset: { value: new THREE.Vector2(object.offsetX / root.maskWidth, object.offsetY / root.maskHeight) },
        uArtScale: { value: new THREE.Vector2(mask.width / root.maskWidth, mask.height / root.maskHeight) },
        uTexel: { value: new THREE.Vector2(1 / mask.width, 1 / mask.height) },
        uEdgeColor: { value: new THREE.Color('#bff4ff') },
        uTime: { value: 0 },
        uFlash: { value: flash },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform sampler2D uMask;
        uniform vec2 uArtOffset;
        uniform vec2 uArtScale;
        uniform vec2 uTexel;
        uniform vec3 uEdgeColor;
        uniform float uTime;
        uniform float uFlash;
        varying vec2 vUv;
        void main() {
          vec4 art = texture2D(uMap, uArtOffset + vUv * uArtScale);
          float e = texture2D(uMask, vUv).r;
          vec2 o = uTexel * 2.0;
          float n = max(max(texture2D(uMask, vUv + vec2(o.x, 0.0)).r, texture2D(uMask, vUv - vec2(o.x, 0.0)).r),
                        max(texture2D(uMask, vUv + vec2(0.0, o.y)).r, texture2D(uMask, vUv - vec2(0.0, o.y)).r));
          float edge = clamp(n - e, 0.0, 1.0) * art.a;
          float shimmer = 0.75 + 0.25 * sin(uTime * 9.0 + (vUv.x + vUv.y) * 40.0);
          vec3 color = mix(art.rgb, uEdgeColor, clamp(edge * (shimmer + uFlash * 2.0), 0.0, 1.0));
          color += uEdgeColor * edge * uFlash * 0.8;
          float alpha = art.a * (1.0 - e);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }
      `,
    });

    // Плоскость маски, сдвинутая так, чтобы точка опоры тела была в начале координат меша.
    const geometry = new THREE.PlaneGeometry(object.width, object.height);
    geometry.translate(object.width / 2 - object.pivot.x, object.height / 2 - object.pivot.y, 0);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.z = 0.015;
    this.ghost = new THREE.Mesh(geometry, this.material);
    this.ghost.position.z = 0.015;
    this.ghost.layers.set(MEMORY_LAYER);
    this.ghost.visible = false;
  }

  /** Радиус для проверки «видно ли объект». */
  get sightRadius(): number {
    return this.object.boundRadius * 0.6;
  }

  updateGhost(rec: Recollection): void {
    this.ghost.visible = rec.known;
    this.ghost.position.x = rec.pos.x;
    this.ghost.position.y = rec.pos.y;
    this.ghost.rotation.z = rec.angle;
  }

  /** alpha — доля шага физики для интерполяции положения. */
  update(time: number, alpha: number, dt: number): void {
    const b = this.object.body;
    this.mesh.position.x = b.prevPos.x + (b.pos.x - b.prevPos.x) * alpha;
    this.mesh.position.y = b.prevPos.y + (b.pos.y - b.prevPos.y) * alpha;
    this.mesh.rotation.z = b.prevAngle + angleDelta(b.prevAngle, b.angle) * alpha;

    this.flash *= 1 - damp(4, dt);
    this.material.uniforms.uFlash.value = this.flash;
    this.material.uniforms.uTime.value = time;
    if (this.object.mask.dirty) {
      this.maskTexture.needsUpdate = true;
      this.object.mask.dirty = false;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.ghost.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.maskTexture.dispose();
  }
}
