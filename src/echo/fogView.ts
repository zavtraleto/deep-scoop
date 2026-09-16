import * as THREE from 'three';
import { CELL, debugConfig, visionConfig } from '../core/config';
import { palette } from '../world/worldMesh';
import type { VisibilityMap } from './visibility';

/**
 * Туман поверх мира (§9.2, решения пользователя). Unknown — темнота. Explored вне света и эха —
 * «мутная память»: вместо живого мира показывается размытый слой памяти (MemoryView) со слепками
 * объектов, выцветший, темнее и медленно плывущий. В свете и эхе — живой чёткий мир.
 * Изведанность — по клеткам (R текстуры), свет и свечение эха — попиксельно из маски LightMaskView.
 */
export class FogView {
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    private readonly map: VisibilityMap,
    lightMask: THREE.Texture,
    memory: THREE.Texture,
  ) {
    this.data = new Uint8Array(map.width * map.height * 4);
    this.texture = new THREE.DataTexture(this.data, map.width, map.height, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCells: { value: this.texture },
        uGrid: { value: new THREE.Vector2(map.width, map.height) },
        uCell: { value: CELL },
        uLight: { value: lightMask },
        uMemory: { value: memory },
        uMemBrightness: { value: 0.55 },
        uMemSaturation: { value: 0.3 },
        uWarp: { value: 0.004 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uUnknown: { value: 1 },
        uAmbient: { value: 0.5 },
        uBeam: { value: 1 },
        uFogColor: { value: palette.wall },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vWorld = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCells;
        uniform vec2 uGrid;
        uniform float uCell;
        uniform sampler2D uLight;
        uniform vec2 uResolution;
        uniform float uUnknown;
        uniform sampler2D uMemory;
        uniform float uMemBrightness;
        uniform float uMemSaturation;
        uniform float uWarp;
        uniform float uTime;
        uniform float uAmbient;
        uniform float uBeam;
        uniform vec3 uFogColor;
        varying vec2 vWorld;
        void main() {
          vec2 cellUv = vec2(vWorld.x / uCell / uGrid.x, -vWorld.y / uCell / uGrid.y);
          float explored = texture2D(uCells, cellUv).r;
          vec2 suv = gl_FragCoord.xy / uResolution;
          vec4 l = texture2D(uLight, suv);
          float echo = l.b;
          float light = max(l.r * uAmbient, l.g * uBeam);
          float vis = max(light, echo);

          // Память медленно «плывёт»: лёгкое искажение выборки.
          vec2 warp = vec2(sin(suv.y * 9.0 + uTime * 0.6), cos(suv.x * 7.0 + uTime * 0.45)) * uWarp;
          vec3 mem = texture2D(uMemory, suv + warp).rgb;
          float lum = dot(mem, vec3(0.299, 0.587, 0.114));
          mem = mix(vec3(lum), mem, uMemSaturation) * uMemBrightness;

          vec3 color = mix(uFogColor, mem, explored);
          float alpha = mix(uUnknown, 1.0, explored) * (1.0 - vis);
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }
      `,
    });

    // Плоскость с запасом за пределы чанка: там скала и тоже должен быть туман.
    const w = map.width * CELL;
    const h = map.height * CELL;
    const margin = 60;
    const geometry = new THREE.PlaneGeometry(w + margin * 2, h + margin * 2);
    geometry.translate(w / 2, -h / 2, 0);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.z = 0.03;
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  update(drawingBuffer: THREE.Vector2, time: number): void {
    this.mesh.visible = !(debugConfig.visible && !debugConfig.fog);
    const { map, data } = this;
    for (let i = 0; i < map.width * map.height; i++) data[i * 4] = map.explored[i] ? 255 : 0;
    this.texture.needsUpdate = true;
    const u = this.material.uniforms;
    u.uResolution.value.copy(drawingBuffer);
    const fog = visionConfig.fog;
    u.uUnknown.value = fog.unknownDarkness;
    u.uMemBrightness.value = fog.memoryBrightness;
    u.uMemSaturation.value = fog.memorySaturation;
    u.uWarp.value = fog.memoryWarp;
    u.uTime.value = time;
    u.uAmbient.value = visionConfig.look.ambientLevel;
    u.uBeam.value = visionConfig.look.beamLevel;
  }
}
