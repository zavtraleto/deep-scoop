import * as THREE from 'three';
import { visionConfig } from '../core/config';

/**
 * Тёплый подводный подсвет: поверх тумана добавляет цвет света по маске LightMaskView.
 * Ореол вокруг существа подсвечивает слабее, чем луч-прожектор.
 */
export class LightGlowView {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(geometry: THREE.BufferGeometry, lightMask: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uLight: { value: lightMask },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Color() },
        uAmbient: { value: 0 },
        uBeam: { value: 0 },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLight;
        uniform vec2 uResolution;
        uniform vec3 uColor;
        uniform float uAmbient;
        uniform float uBeam;
        void main() {
          vec4 l = texture2D(uLight, gl_FragCoord.xy / uResolution);
          float k = l.r * uAmbient + l.g * uBeam;
          if (k < 0.002) discard;
          gl_FragColor = vec4(uColor * k, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.z = 0.035;
    this.mesh.renderOrder = 11;
    this.mesh.frustumCulled = false;
  }

  update(drawingBuffer: THREE.Vector2): void {
    const u = this.material.uniforms;
    const look = visionConfig.look;
    u.uResolution.value.copy(drawingBuffer);
    u.uColor.value.set(look.color);
    u.uAmbient.value = look.ambientTint;
    u.uBeam.value = look.beamTint;
  }
}
