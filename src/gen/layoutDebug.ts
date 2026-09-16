import * as THREE from 'three';
import { CELL, debugConfig } from '../core/config';
import type { ChunkMap } from './buildChunk';
import { rectCenter } from './buildChunk';
import { corridorMid } from './geometry';
import { chunkSize } from './layout';

/**
 * Отладка раскладки: границы слотов и граф комнат (центр комнаты → центр прохода → центр комнаты).
 * Видна при включённой отладке (G) и галке «раскладка чанка».
 */
export class LayoutDebug {
  readonly group = new THREE.Group();

  constructor(map: ChunkMap) {
    const { layout } = map;
    const { w, h } = chunkSize(layout);
    const slots: number[] = [];
    for (let sx = 0; sx <= layout.slotsX; sx++) {
      const x = sx * layout.slotSize * CELL;
      slots.push(x, 0, 0, x, -h * CELL, 0);
    }
    for (let sy = 0; sy <= layout.slotsY; sy++) {
      const y = -sy * layout.slotSize * CELL;
      slots.push(0, y, 0, w * CELL, y, 0);
    }
    const slotGeo = new THREE.BufferGeometry();
    slotGeo.setAttribute('position', new THREE.Float32BufferAttribute(slots, 3));
    this.group.add(
      new THREE.LineSegments(slotGeo, new THREE.LineBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.35 })),
    );

    const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
    const edges: number[] = [];
    layout.corridors.forEach((c, i) => {
      const a = rectCenter(rooms.get(c.a)!.rect);
      const b = rectCenter(rooms.get(c.b)!.rect);
      const mc = corridorMid(map.corridors[i]);
      const m = { x: mc.x * CELL, y: -mc.y * CELL };
      edges.push(a.x, a.y, 0, m.x, m.y, 0, m.x, m.y, 0, b.x, b.y, 0);
    });
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    this.group.add(
      new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.6 })),
    );

    const nodes = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.35, 16),
      new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.8 }),
      layout.rooms.length,
    );
    layout.rooms.forEach((r, i) => {
      const c = rectCenter(r.rect);
      nodes.setMatrixAt(i, new THREE.Matrix4().makeTranslation(c.x, c.y, 0));
    });
    this.group.add(nodes);
    this.group.position.z = 0.02;
  }

  update(): void {
    this.group.visible = debugConfig.visible && debugConfig.showLayout;
  }
}
