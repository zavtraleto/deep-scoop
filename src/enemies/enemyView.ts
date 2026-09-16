import * as THREE from 'three';
import { angleDelta, damp, type Vec2 } from '../math/vec2';
import type { Enemy, EnemyKind } from './enemy';

const BODY_ORDER = 19; // над туманом, под игроком: видимость врагов решаем сами

const kindLook: Record<EnemyKind, { color: string; spikes: number }> = {
  hunter: { color: '#e5485d', spikes: 9 },
};

/** Колючее тело: звезда с неровными лучами. radius — радиус столкновений. */
const spikyShape = (radius: number, spikes: number): THREE.Shape => {
  const shape = new THREE.Shape();
  const n = spikes * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 === 0 ? radius * (1.25 + 0.12 * Math.sin(i * 2.3)) : radius * 0.78;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
};

const overlay = (color: string | THREE.Color) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false });

interface EnemyMesh {
  group: THREE.Group;
  body: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  eye: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  base: THREE.Color;
  alpha: number;
}

interface Marker {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
}

/**
 * Враги (процедурные фигуры — решение пользователя) и маркеры последней позиции (§9.3).
 * Враг виден, только когда его освещает игрок; маркер ставит волна эха, если враг был в её поле зрения.
 * Вспышка «заметил» — белеет и раздувается.
 */
export class EnemyView {
  readonly group = new THREE.Group();
  private readonly meshes: EnemyMesh[];
  private readonly markers: Marker[] = [];
  private readonly markerGeometry: THREE.RingGeometry;

  constructor(enemies: readonly Enemy[], radius: number) {
    this.markerGeometry = new THREE.RingGeometry(radius * 0.9, radius * 1.25, 28);
    this.meshes = enemies.map((e) => {
      const look = kindLook[e.kind];
      const body = new THREE.Mesh(new THREE.ShapeGeometry(spikyShape(radius, look.spikes)), overlay(look.color));
      const eye = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.28, 16), overlay('#fff4d6'));
      eye.position.set(radius * 0.35, 0, 0.001);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.12, 12), overlay('#1a0d12'));
      pupil.position.set(radius * 0.06, 0, 0.001);
      eye.add(pupil);
      body.add(eye);
      const group = new THREE.Group();
      group.add(body);
      group.traverse((o) => (o.renderOrder = BODY_ORDER));
      this.group.add(group);
      return { group, body, eye, base: new THREE.Color(look.color), alpha: 0 };
    });
  }

  /** Фронт эха застал врага на виду — маркер на этом месте. */
  mark(pos: Vec2, markerTime: number): void {
    const mesh = new THREE.Mesh(this.markerGeometry, overlay('#ff6b7d'));
    mesh.position.set(pos.x, pos.y, 0.02);
    mesh.renderOrder = BODY_ORDER - 1;
    this.group.add(mesh);
    this.markers.push({ mesh, life: markerTime });
  }

  clearMarkers(): void {
    for (const m of this.markers) {
      m.mesh.removeFromParent();
      m.mesh.material.dispose();
    }
    this.markers.length = 0;
  }

  /** visible(e) — освещён ли враг сейчас. alpha — доля шага физики. */
  update(
    enemies: readonly Enemy[],
    visible: (e: Enemy, pos: Vec2) => boolean,
    alpha: number,
    time: number,
    dt: number,
    markerTime: number,
  ): void {
    enemies.forEach((e, i) => {
      const m = this.meshes[i];
      const x = e.prevPos.x + (e.pos.x - e.prevPos.x) * alpha;
      const y = e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha;
      const heading = e.prevHeading + angleDelta(e.prevHeading, e.heading) * alpha;
      m.group.position.set(x, y, 0.03);
      m.body.rotation.z = heading;
      // Тело медленно «дышит» и шевелит колючками.
      const breathe = 1 + 0.05 * Math.sin(time * 4 + e.id) + 0.3 * e.alert;
      m.body.scale.setScalar(breathe);
      m.body.material.color.copy(m.base).lerp(new THREE.Color('#ffffff'), e.alert * 0.8);

      const target = visible(e, { x, y }) ? 1 : 0;
      m.alpha += (target - m.alpha) * damp(10, dt);
      m.group.visible = m.alpha > 0.01;
      m.group.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).opacity = m.alpha;
      });
    });

    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mk = this.markers[i];
      mk.life -= dt;
      const t = Math.max(0, mk.life / markerTime);
      mk.mesh.material.opacity = t * 0.9;
      mk.mesh.scale.setScalar(1 + (1 - t) * 0.4);
      if (mk.life <= 0) {
        mk.mesh.removeFromParent();
        mk.mesh.material.dispose();
        this.markers.splice(i, 1);
      }
    }
  }
}
