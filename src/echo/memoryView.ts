import * as THREE from 'three';

/** Слой сцены, в котором живёт «память»: пол, стены и слепки объектов. */
export const MEMORY_LAYER = 1;

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Слой «мутной памяти» (решение пользователя): сцена слоя MEMORY_LAYER рисуется в текстуру
 * в половинном разрешении и размывается двумя проходами Гаусса. Выцветание, затемнение
 * и «плывение» делает туман при чтении этой текстуры.
 */
export class MemoryView {
  private readonly blurA: THREE.WebGLRenderTarget;
  private readonly blurB: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly sceneTarget: THREE.WebGLRenderTarget;

  constructor() {
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, type: THREE.HalfFloatType });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });
    this.blurB = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });

    this.blurMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uInput: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
      },
      vertexShader: fullscreenVertex,
      // Гаусс на 9 выборок с линейной фильтрацией (эквивалент 17 пикселей).
      fragmentShader: /* glsl */ `
        uniform sampler2D uInput;
        uniform vec2 uDirection;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uInput, vUv) * 0.2270270270;
          c += texture2D(uInput, vUv + uDirection * 1.3846153846) * 0.3162162162;
          c += texture2D(uInput, vUv - uDirection * 1.3846153846) * 0.3162162162;
          c += texture2D(uInput, vUv + uDirection * 3.2307692308) * 0.0702702703;
          c += texture2D(uInput, vUv - uDirection * 3.2307692308) * 0.0702702703;
          gl_FragColor = c;
        }
      `,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  /** Готовая размытая память. */
  get texture(): THREE.Texture {
    return this.blurB.texture;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.sceneTarget.setSize(w, h);
    this.blurA.setSize(w, h);
    this.blurB.setSize(w, h);
  }

  /** blurRadius — сила размытия (шаг выборок × число проходов) в пикселях половинного разрешения. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, blurRadius: number): void {
    const prevTarget = renderer.getRenderTarget();
    const prevMask = camera.layers.mask;

    camera.layers.set(MEMORY_LAYER);
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;

    const w = this.blurA.width;
    const h = this.blurA.height;
    const u = this.blurMaterial.uniforms;
    // Шаг выборок не больше ~1.5 пикселя, иначе между ними видны полосы-двойники:
    // сильное размытие набирается числом проходов (каждый — по горизонтали и вертикали).
    const passes = Math.min(4, Math.max(1, Math.ceil(blurRadius / 1.5)));
    const r = blurRadius / passes;
    let input: THREE.Texture = this.sceneTarget.texture;
    for (let pass = 0; pass < passes; pass++) {
      u.uInput.value = input;
      u.uDirection.value.set(r / w, 0);
      renderer.setRenderTarget(this.blurA);
      renderer.render(this.quadScene, this.quadCamera);
      u.uInput.value = this.blurA.texture;
      u.uDirection.value.set(0, r / h);
      renderer.setRenderTarget(this.blurB);
      renderer.render(this.quadScene, this.quadCamera);
      input = this.blurB.texture;
    }
    renderer.setRenderTarget(prevTarget);
  }
}
