import * as THREE from 'three';
import { CELL } from '../core/config';
import { Cell, type Grid, type WallIndex } from './grid';

export const palette = {
  wall: new THREE.Color('#10141d'),
  floor: new THREE.Color('#252d3d'),
  gridLine: new THREE.Color('#34405a'),
  wallEdge: new THREE.Color('#8fb3e0'),
};

/** Пол (все непустые клетки) с процедурной сеткой клеток — чтобы глазом читались скорость и инерция. */
const buildFloor = (grid: Grid): THREE.Mesh => {
  const pos: number[] = [];
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    pos.push(ax, ay, 0, bx, by, 0, cx, cy, 0);

  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const c = grid.get(cx, cy);
      const x0 = cx * CELL;
      const x1 = x0 + CELL;
      const y1 = -cy * CELL; // верх
      const y0 = y1 - CELL; // низ
      // Пустая часть клетки. Твёрдый треугольник диагонали — в углу из её имени.
      switch (c) {
        case Cell.Empty:
          tri(x0, y0, x1, y0, x1, y1);
          tri(x0, y0, x1, y1, x0, y1);
          break;
        case Cell.DiagTL:
          tri(x0, y0, x1, y0, x1, y1);
          break;
        case Cell.DiagTR:
          tri(x0, y0, x1, y0, x0, y1);
          break;
        case Cell.DiagBL:
          tri(x1, y0, x1, y1, x0, y1);
          break;
        case Cell.DiagBR:
          tri(x0, y0, x1, y1, x0, y1);
          break;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uFloor: { value: palette.floor },
      uLine: { value: palette.gridLine },
      uCell: { value: CELL },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vWorld = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFloor;
      uniform vec3 uLine;
      uniform float uCell;
      varying vec2 vWorld;
      void main() {
        vec2 g = vWorld / uCell;
        vec2 w = fwidth(g);
        vec2 d = abs(fract(g - 0.5) - 0.5) / w;
        float line = 1.0 - clamp(min(d.x, d.y) - 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(uFloor, uLine, line * 0.8), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
};

/** Светлый контур стен — тонкие полосы вдоль отрезков коллизии. */
const buildWallEdges = (walls: WallIndex, thickness = 0.08): THREE.Mesh => {
  const pos: number[] = [];
  const h = thickness / 2;
  for (const s of walls.all) {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // Продлеваем на полтолщины, чтобы стыки под 45° и 90° не давали щелей.
    const ax = s.ax - ux * h;
    const ay = s.ay - uy * h;
    const bx = s.bx + ux * h;
    const by = s.by + uy * h;
    const nx = -uy * h;
    const ny = ux * h;
    pos.push(ax + nx, ay + ny, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0);
    pos.push(ax + nx, ay + ny, 0, bx - nx, by - ny, 0, ax - nx, ay - ny, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: palette.wallEdge, side: THREE.DoubleSide }));
};

export const buildWorldMesh = (grid: Grid, walls: WallIndex): THREE.Group => {
  const group = new THREE.Group();
  const floor = buildFloor(grid);
  const edges = buildWallEdges(walls);
  edges.position.z = 0.01;
  group.add(floor, edges);
  return group;
};
