import { stickConfig } from '../core/config';
import { length, type Vec2 } from '../math/vec2';
import { followOrigin, stickToInput } from './stickMath';

/**
 * Ввод (§5.1): виртуальный стик на Pointer Events (одинаково для мыши и тача) + WASD/стрелки для отладки.
 * Точка нажатия — центр стика, вектор до пальца задаёт направление и силу.
 */
export class Input {
  private pointerId: number | null = null;
  private origin: Vec2 = { x: 0, y: 0 };
  private finger: Vec2 = { x: 0, y: 0 };
  private readonly keys = new Set<string>();
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  constructor(private readonly surface: HTMLElement) {
    this.base = document.createElement('div');
    this.knob = document.createElement('div');
    Object.assign(this.base.style, {
      position: 'fixed',
      borderRadius: '50%',
      border: '2px solid rgba(200, 225, 255, 0.35)',
      background: 'rgba(200, 225, 255, 0.06)',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
    });
    Object.assign(this.knob.style, {
      position: 'fixed',
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'rgba(200, 225, 255, 0.45)',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
    });
    document.body.append(this.base, this.knob);

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });
  }

  /** Вектор ввода в координатах мира (y вверх), длина 0..1. */
  get vector(): Vec2 {
    if (this.pointerId !== null) {
      return stickToInput(this.finger.x - this.origin.x, this.finger.y - this.origin.y, stickConfig);
    }
    const k = this.keys;
    const v = {
      x: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      y: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
    };
    const len = length(v);
    return len > 1 ? { x: v.x / len, y: v.y / len } : v;
  }

  get stickActive(): boolean {
    return this.pointerId !== null;
  }

  private onDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.finger = { ...this.origin };
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // Синтетические события без активного указателя — захват не нужен.
    }
    this.updateView();
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.finger = { x: e.clientX, y: e.clientY };
    if (stickConfig.followFinger) this.origin = followOrigin(this.origin, this.finger, stickConfig.radius);
    this.updateView();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.release();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('.lil-gui')) return;
    this.keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  };

  private release() {
    this.pointerId = null;
    this.base.style.display = 'none';
    this.knob.style.display = 'none';
  }

  private updateView() {
    const r = stickConfig.radius;
    const dx = this.finger.x - this.origin.x;
    const dy = this.finger.y - this.origin.y;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    Object.assign(this.base.style, {
      display: 'block',
      left: `${this.origin.x}px`,
      top: `${this.origin.y}px`,
      width: `${r * 2}px`,
      height: `${r * 2}px`,
    });
    Object.assign(this.knob.style, {
      display: 'block',
      left: `${this.origin.x + dx * k}px`,
      top: `${this.origin.y + dy * k}px`,
    });
  }
}
