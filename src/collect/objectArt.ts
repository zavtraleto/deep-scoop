import type { Vec2 } from '../math/vec2';
import { EraseMask } from './eraseMask';
import { MemoryObject, maskSize, objectValue, type ObjectClass, type ObjectClassDef } from './memoryObject';

export interface ObjectArt {
  /** Картинка высокого разрешения для текстуры. */
  canvas: HTMLCanvasElement;
  /** RGB картинки в разрешении маски (строка 0 — низ) — цвет частиц стёртой памяти. */
  colors: Uint8Array;
}

export interface BuiltObject {
  object: MemoryObject;
  art: ObjectArt;
}

const ART_PX_PER_UNIT = 72;

/**
 * Заглушка Memory Object зоны 0–1 (§7): узнаваемый предмет с лёгким искажением — старый ламповый телевизор.
 * Рисуется в нормализованных координатах 0..1 по ширине и высоте.
 */
const drawTelevision = (g: CanvasRenderingContext2D, w: number, h: number) => {
  // Лёгкое искажение памяти: предмет чуть «поплыл».
  g.setTransform(1, 0.035, -0.06, 1, w * 0.03, -h * 0.01);

  // Антенны.
  g.strokeStyle = '#8a8f99';
  g.lineWidth = w * 0.018;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.24);
  g.lineTo(w * 0.28, h * 0.03);
  g.moveTo(w * 0.5, h * 0.24);
  g.lineTo(w * 0.74, h * 0.06);
  g.stroke();
  g.fillStyle = '#c9ced8';
  for (const [x, y] of [
    [0.28, 0.03],
    [0.74, 0.06],
  ]) {
    g.beginPath();
    g.arc(w * x, h * y, w * 0.025, 0, Math.PI * 2);
    g.fill();
  }

  // Ножки.
  g.fillStyle = '#4a3322';
  g.fillRect(w * 0.16, h * 0.86, w * 0.06, h * 0.12);
  g.fillRect(w * 0.78, h * 0.86, w * 0.06, h * 0.12);

  // Корпус.
  const body = g.createLinearGradient(0, h * 0.22, 0, h * 0.9);
  body.addColorStop(0, '#b0773f');
  body.addColorStop(1, '#6e4524');
  g.fillStyle = body;
  g.beginPath();
  g.roundRect(w * 0.04, h * 0.22, w * 0.92, h * 0.68, w * 0.07);
  g.fill();
  g.strokeStyle = '#3b2616';
  g.lineWidth = w * 0.012;
  g.stroke();

  // Экран с воспоминанием: размытое лицо в помехах.
  const sx = w * 0.1;
  const sy = h * 0.29;
  const sw = w * 0.6;
  const sh = h * 0.52;
  const screen = g.createRadialGradient(sx + sw * 0.5, sy + sh * 0.5, sw * 0.05, sx + sw * 0.5, sy + sh * 0.5, sw * 0.7);
  screen.addColorStop(0, '#9fd8e8');
  screen.addColorStop(0.6, '#3f7f96');
  screen.addColorStop(1, '#16303c');
  g.fillStyle = screen;
  g.beginPath();
  g.roundRect(sx, sy, sw, sh, w * 0.08);
  g.fill();

  g.save();
  g.clip();
  g.globalAlpha = 0.55;
  g.fillStyle = '#f4e6d0';
  g.beginPath();
  g.ellipse(sx + sw * 0.5, sy + sh * 0.52, sw * 0.2, sh * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d2a33';
  g.beginPath();
  g.arc(sx + sw * 0.42, sy + sh * 0.45, sw * 0.03, 0, Math.PI * 2);
  g.arc(sx + sw * 0.58, sy + sh * 0.45, sw * 0.03, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1d2a33';
  g.lineWidth = w * 0.01;
  g.beginPath();
  g.arc(sx + sw * 0.5, sy + sh * 0.58, sw * 0.08, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  // Строки развёртки.
  g.globalAlpha = 0.18;
  g.fillStyle = '#ffffff';
  for (let y = sy; y < sy + sh; y += h * 0.022) g.fillRect(sx, y, sw, h * 0.006);
  g.restore();

  // Ручки и динамик.
  g.fillStyle = '#e3c79a';
  for (const y of [0.4, 0.55]) {
    g.beginPath();
    g.arc(w * 0.83, h * y, w * 0.045, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3b2616';
  g.lineWidth = w * 0.008;
  for (let y = 0.66; y < 0.82; y += 0.03) {
    g.beginPath();
    g.moveTo(w * 0.76, h * y);
    g.lineTo(w * 0.9, h * y);
    g.stroke();
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
};

/** Непрозрачность и цвета картинки в разрешении маски. Строки переворачиваются: в маске строка 0 — низ. */
const sampleForMask = (canvas: HTMLCanvasElement, mw: number, mh: number) => {
  const small = document.createElement('canvas');
  small.width = mw;
  small.height = mh;
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0, mw, mh);
  const data = g.getImageData(0, 0, mw, mh).data;
  const opaque = new Uint8Array(mw * mh);
  const colors = new Uint8Array(mw * mh * 3);
  for (let row = 0; row < mh; row++) {
    for (let col = 0; col < mw; col++) {
      const src = (row * mw + col) * 4;
      const dst = (mh - 1 - row) * mw + col;
      opaque[dst] = data[src + 3] > 96 ? 1 : 0;
      colors[dst * 3] = data[src];
      colors[dst * 3 + 1] = data[src + 1];
      colors[dst * 3 + 2] = data[src + 2];
    }
  }
  return { opaque, colors };
};

export const buildTelevision = (
  center: Vec2,
  cls: ObjectClass,
  classes: Record<ObjectClass, ObjectClassDef>,
  playerDiameter: number,
  pixelsPerUnit: number,
  chunkIndex = 0,
): BuiltObject => {
  const def = classes[cls];
  const width = def.size * playerDiameter;
  const height = width * (6 / 7);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ART_PX_PER_UNIT);
  canvas.height = Math.round(height * ART_PX_PER_UNIT);
  drawTelevision(canvas.getContext('2d')!, canvas.width, canvas.height);

  const { w, h } = maskSize(width, height, pixelsPerUnit);
  const { opaque, colors } = sampleForMask(canvas, w, h);
  const object = new MemoryObject(center, width, height, cls, objectValue(def.value, chunkIndex), new EraseMask(w, h, opaque));
  return { object, art: { canvas, colors } };
};
