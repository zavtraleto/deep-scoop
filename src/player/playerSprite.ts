import * as THREE from 'three';
import { PLAYER_RADIUS } from '../core/config';

const SPRITE_WORLD_SIZE = 1.8; // больше диаметра, чтобы влезли свечение и хвостик
const TEX = 256;

/** Заглушка существа: круглое тело, большой глаз, ротик-ковш спереди (+x), хвостик сзади. */
const drawCreature = (): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d')!;
  const px = TEX / SPRITE_WORLD_SIZE; // пикселей на единицу мира
  const cx = TEX / 2;
  const cy = TEX / 2;
  const r = PLAYER_RADIUS * px;

  const glow = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.7);
  glow.addColorStop(0, 'rgba(170, 220, 255, 0.35)');
  glow.addColorStop(1, 'rgba(170, 220, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, TEX, TEX);

  // Хвостик.
  g.fillStyle = '#b9d7f2';
  g.beginPath();
  g.moveTo(cx - r * 0.7, cy - r * 0.35);
  g.quadraticCurveTo(cx - r * 1.55, cy - r * 0.55, cx - r * 1.45, cy + r * 0.05);
  g.quadraticCurveTo(cx - r * 1.3, cy + r * 0.45, cx - r * 0.7, cy + r * 0.3);
  g.closePath();
  g.fill();

  // Тело.
  const body = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#cfe3f7');
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // Ковш-ротик спереди.
  g.strokeStyle = '#3a5373';
  g.lineWidth = r * 0.14;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx + r * 0.55, cy + r * 0.12, r * 0.32, -0.3 * Math.PI, 0.55 * Math.PI);
  g.stroke();

  // Глаз.
  g.fillStyle = '#1b2433';
  g.beginPath();
  g.arc(cx + r * 0.3, cy - r * 0.3, r * 0.24, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx + r * 0.37, cy - r * 0.38, r * 0.08, 0, Math.PI * 2);
  g.fill();

  return c;
};

export class PlayerSprite {
  readonly mesh: THREE.Mesh;

  constructor() {
    const texture = new THREE.CanvasTexture(drawCreature());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SPRITE_WORLD_SIZE, SPRITE_WORLD_SIZE),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    this.mesh.position.z = 0.05;
  }

  /** Поворот к направлению; при движении влево спрайт отражается, чтобы существо не плыло вверх ногами. */
  update(x: number, y: number, facing: number): void {
    this.mesh.position.x = x;
    this.mesh.position.y = y;
    this.mesh.rotation.z = facing;
    this.mesh.scale.y = Math.cos(facing) < 0 ? -1 : 1;
  }
}
