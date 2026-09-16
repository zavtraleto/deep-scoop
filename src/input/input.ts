import { mouseConfig, stickConfig } from '../core/config';
import { length, type Vec2 } from '../math/vec2';
import { cursorToInput, followOrigin, stickToInput } from './stickMath';

/** Что нужно вводу от игры, чтобы перевести курсор в мир. */
export interface InputContext {
  player: Vec2;
  /** Точка мира под точкой экрана; u, v — доли ширины и высоты игрового поля (v вниз). */
  screenToWorld: (u: number, v: number) => Vec2;
}

/**
 * Ввод (§5.1, решение пользователя):
 * - тач и перо — виртуальный стик: точка касания — центр, вектор до пальца — направление и сила;
 * - мышь — пока зажата ЛКМ, персонаж плывёт к курсору; сила растёт с расстоянием до курсора;
 * - WASD и стрелки — для отладки.
 */
export class Input {
  // Стик (тач, либо мышь в режиме mouseConfig.asStick).
  private stickId: number | null = null;
  private origin: Vec2 = { x: 0, y: 0 };
  private finger: Vec2 = { x: 0, y: 0 };
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  // Мышь.
  private mouseHeld = false;
  private mouseInside = false;
  private mouse: Vec2 = { x: 0, y: 0 };
  private readonly cursor: HTMLDivElement;

  private readonly keys = new Set<string>();

  constructor(private readonly surface: HTMLElement) {
    this.base = this.overlay({
      borderRadius: '50%',
      border: '2px solid rgba(200, 225, 255, 0.35)',
      background: 'rgba(200, 225, 255, 0.06)',
    });
    this.knob = this.overlay({
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'rgba(200, 225, 255, 0.45)',
    });
    this.cursor = this.overlay({
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      border: '2px solid rgba(200, 235, 255, 0.55)',
      boxShadow: '0 0 8px rgba(160, 220, 255, 0.35)',
      transition: 'width 80ms, height 80ms, border-color 80ms',
    });

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('pointerenter', this.onEnter);
    surface.addEventListener('pointerleave', this.onLeave);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    // Кнопку могут отпустить за пределами поля.
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseHeld = false;
      this.updateCursor();
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.releaseStick();
      this.mouseHeld = false;
      this.mouseInside = false;
      this.updateCursor();
    });
  }

  /** Вектор ввода в координатах мира (y вверх), длина 0..1. */
  vector(ctx: InputContext): Vec2 {
    if (this.stickId !== null) {
      return stickToInput(this.finger.x - this.origin.x, this.finger.y - this.origin.y, stickConfig);
    }
    if (this.mouseHeld && this.mouseInside) {
      const rect = this.surface.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const target = ctx.screenToWorld((this.mouse.x - rect.left) / rect.width, (this.mouse.y - rect.top) / rect.height);
        return cursorToInput(ctx.player, target, mouseConfig);
      }
    }
    const k = this.keys;
    const v = {
      x: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      y: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
    };
    const len = length(v);
    return len > 1 ? { x: v.x / len, y: v.y / len } : v;
  }

  private overlay(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
      zIndex: '5',
      ...style,
    });
    document.body.append(el);
    return el;
  }

  private usesCursor(e: PointerEvent): boolean {
    return e.pointerType === 'mouse' && !mouseConfig.asStick;
  }

  private onDown = (e: PointerEvent) => {
    if (this.usesCursor(e)) {
      if (e.button !== 0) return;
      this.mouseHeld = true;
      this.mouseInside = true;
      this.mouse = { x: e.clientX, y: e.clientY };
      this.updateCursor();
      e.preventDefault();
      return;
    }
    if (this.stickId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.stickId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.finger = { ...this.origin };
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // Синтетические события без активного указателя — захват не нужен.
    }
    this.updateStickView();
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    if (this.usesCursor(e)) {
      this.mouseInside = true;
      this.mouse = { x: e.clientX, y: e.clientY };
      this.updateCursor();
      return;
    }
    if (e.pointerId !== this.stickId) return;
    this.finger = { x: e.clientX, y: e.clientY };
    if (stickConfig.followFinger) this.origin = followOrigin(this.origin, this.finger, stickConfig.radius);
    this.updateStickView();
  };

  private onUp = (e: PointerEvent) => {
    if (this.usesCursor(e)) {
      if (e.button === 0) this.mouseHeld = false;
      this.updateCursor();
      return;
    }
    if (e.pointerId === this.stickId) this.releaseStick();
  };

  private onEnter = (e: PointerEvent) => {
    if (!this.usesCursor(e)) return;
    this.mouseInside = true;
    // Кнопку могли отпустить или нажать вне поля: верим актуальному состоянию.
    this.mouseHeld = (e.buttons & 1) !== 0 && this.mouseHeld;
    this.mouse = { x: e.clientX, y: e.clientY };
    this.updateCursor();
  };

  private onLeave = (e: PointerEvent) => {
    if (!this.usesCursor(e)) return;
    // Курсор ушёл за поле или на панель тюнинга — ввод гаснет.
    this.mouseInside = false;
    this.updateCursor();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('.lil-gui')) return;
    this.keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  };

  private releaseStick() {
    this.stickId = null;
    this.base.style.display = 'none';
    this.knob.style.display = 'none';
  }

  /** Свой курсор вместо системного: кольцо, при зажатой ЛКМ ярче и меньше. */
  private updateCursor() {
    const visible = this.mouseInside && !mouseConfig.asStick;
    this.surface.style.cursor = visible ? 'none' : '';
    const held = this.mouseHeld;
    Object.assign(this.cursor.style, {
      display: visible ? 'block' : 'none',
      left: `${this.mouse.x}px`,
      top: `${this.mouse.y}px`,
      width: held ? '16px' : '22px',
      height: held ? '16px' : '22px',
      borderColor: held ? 'rgba(220, 245, 255, 0.95)' : 'rgba(200, 235, 255, 0.55)',
    });
  }

  private updateStickView() {
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
