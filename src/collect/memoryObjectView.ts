import * as THREE from 'three';
import type { ObjectArt } from './objectArt';
import type { MemoryObject } from './memoryObject';

/**
 * Отрисовка Memory Object: маска стирания — альфа спрайта (§6.3). Край стёртой области
 * светится: видно, где ковш только что прошёл, и стирание ощущается «вкусным».
 */
export class MemoryObjectView {
  readonly mesh: THREE.Mesh;
  private readonly maskTexture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    private readonly object: MemoryObject,
    art: ObjectArt,
  ) {
    const map = new THREE.CanvasTexture(art.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;

    const { mask } = object;
    this.maskTexture = new THREE.DataTexture(mask.erased, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTexture.unpackAlignment = 1; // ширина маски не кратна 4
    this.maskTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.minFilter = THREE.LinearFilter;
    this.maskTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: map },
        uMask: { value: this.maskTexture },
        uTexel: { value: new THREE.Vector2(1 / mask.width, 1 / mask.height) },
        uEdgeColor: { value: new THREE.Color('#bff4ff') },
        uTime: { value: 0 },
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
        uniform vec2 uTexel;
        uniform vec3 uEdgeColor;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec4 art = texture2D(uMap, vUv);
          float e = texture2D(uMask, vUv).r;
          vec2 o = uTexel * 2.0;
          float n = max(max(texture2D(uMask, vUv + vec2(o.x, 0.0)).r, texture2D(uMask, vUv - vec2(o.x, 0.0)).r),
                        max(texture2D(uMask, vUv + vec2(0.0, o.y)).r, texture2D(uMask, vUv - vec2(0.0, o.y)).r));
          float edge = clamp(n - e, 0.0, 1.0) * art.a;
          float shimmer = 0.75 + 0.25 * sin(uTime * 9.0 + (vUv.x + vUv.y) * 40.0);
          vec3 color = mix(art.rgb, uEdgeColor, edge * shimmer);
          float alpha = art.a * (1.0 - e);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(object.width, object.height), this.material);
    this.mesh.position.set(object.center.x, object.center.y, 0.015);
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    if (this.object.mask.dirty) {
      this.maskTexture.needsUpdate = true;
      this.object.mask.dirty = false;
    }
  }
}
