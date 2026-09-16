import { debugConfig } from '../core/config';

const UPDATE_INTERVAL = 0.5; // с

/** Счётчик кадров в левом верхнем углу. Часть отладки: прячется клавишей G вместе с панелью. */
export class FpsMeter {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: 'calc(8px + env(safe-area-inset-left, 0px))',
      top: 'calc(8px + env(safe-area-inset-top, 0px))',
      padding: '3px 7px',
      borderRadius: '4px',
      background: 'rgba(0, 0, 0, 0.55)',
      color: '#cfe8ff',
      font: '12px/1.3 ui-monospace, Menlo, Consolas, monospace',
      pointerEvents: 'none',
      zIndex: '10',
      whiteSpace: 'pre',
    });
    this.el.textContent = '— fps';
    document.body.append(this.el);
  }

  /** dt — длительность кадра, с. */
  tick(dt: number): void {
    this.el.style.display = debugConfig.visible ? 'block' : 'none';
    if (dt <= 0) return;
    this.frames++;
    this.elapsed += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.elapsed < UPDATE_INTERVAL) return;
    const fps = this.frames / this.elapsed;
    // Худший кадр за интервал — чтобы были видны рывки, которые среднее скрывает.
    this.el.textContent = `${fps.toFixed(0)} fps  max ${(this.worst * 1000).toFixed(0)} ms`;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
  }
}
