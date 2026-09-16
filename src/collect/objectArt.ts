import type { Vec2 } from '../math/vec2';
import { alphaBounds, artSize, classFromPath, nameFromPath, type ArtLibrary, type ArtSource } from './artLibrary';
import { createRootObject, maskSize, objectValue, type MemoryObject, type ObjectClass, type ObjectClassDef } from './memoryObject';

export type CanvasArt = ArtSource<HTMLCanvasElement>;
export type CanvasArtLibrary = ArtLibrary<HTMLCanvasElement>;

export interface ObjectArt {
  /** RGB картинки в разрешении маски корня (строка 0 — низ) — цвет частиц стёртой памяти. */
  colors: Uint8Array;
  maskWidth: number;
}

export interface BuiltObject {
  object: MemoryObject;
  art: ObjectArt;
}

/** Пиксель считается частью предмета, если его альфа выше порога (0..255). Полупрозрачный ореол — нет. */
const OPAQUE_ALPHA = 96;
/** Большая сторона картинки после загрузки, px: Large на экране ~500 px, больше не нужно. */
const MAX_ART_SIDE = 1024;

// Все картинки из папок классов. Новый файл попадает в игру после пересборки, список вести не нужно.
const artFiles = import.meta.glob('../assets/objects/*/*.{png,webp,PNG,WEBP}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`не загрузилась картинка ${url}`));
    img.src = url;
  });

/** Картинка → холст без прозрачных полей, не больше MAX_ART_SIDE. */
const trimImage = (img: HTMLImageElement): HTMLCanvasElement | null => {
  const src = document.createElement('canvas');
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(img, 0, 0);
  const box = alphaBounds(sg.getImageData(0, 0, src.width, src.height).data, src.width, src.height, OPAQUE_ALPHA);
  if (!box) return null;
  const scale = Math.min(1, MAX_ART_SIDE / Math.max(box.w, box.h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.w * scale));
  out.height = Math.max(1, Math.round(box.h * scale));
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  return out;
};

const PLACEHOLDER_PX = 256;
const placeholderColors: Record<ObjectClass, [string, string]> = {
  small: ['#5f9dbf', '#2f5a73'],
  medium: ['#c49358', '#6e4e2a'],
  large: ['#a877c2', '#5a3a6e'],
};

/** Нейтральная заглушка: плашка с буквой класса — видно, что сюда нужна картинка. */
const drawPlaceholder = (cls: ObjectClass): CanvasArt => {
  const c = document.createElement('canvas');
  c.width = PLACEHOLDER_PX;
  c.height = PLACEHOLDER_PX;
  const g = c.getContext('2d')!;
  const s = PLACEHOLDER_PX;
  const [fill, dark] = placeholderColors[cls];
  g.fillStyle = fill;
  g.strokeStyle = dark;
  g.lineWidth = s * 0.05;
  g.beginPath();
  g.roundRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92, s * 0.18);
  g.fill();
  g.stroke();
  g.fillStyle = dark;
  g.font = `bold ${s * 0.6}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(cls[0].toUpperCase(), s / 2, s * 0.54);
  return { name: `placeholder-${cls}`, cls, image: c, aspect: 1 };
};

/**
 * Загрузить картинки из `src/assets/objects/<класс>/`. Файл, который не загрузился или пуст,
 * пропускается с предупреждением. Класс без картинок получает заглушку.
 */
export const loadArtLibrary = async (): Promise<CanvasArtLibrary> => {
  const lib: CanvasArtLibrary = { small: [], medium: [], large: [] };
  const entries = Object.entries(artFiles).sort(([a], [b]) => a.localeCompare(b));
  const loaded = await Promise.all(
    entries.map(async ([path, url]) => {
      const cls = classFromPath(path);
      if (!cls) return null;
      try {
        const image = trimImage(await loadImage(url));
        if (!image) {
          console.warn(`картинка ${path} полностью прозрачная — пропущена`);
          return null;
        }
        return { name: nameFromPath(path), cls, image, aspect: image.width / image.height } satisfies CanvasArt;
      } catch (e) {
        console.warn(e);
        return null;
      }
    }),
  );
  for (const art of loaded) if (art) lib[art.cls].push(art);
  for (const cls of Object.keys(lib) as ObjectClass[]) if (lib[cls].length === 0) lib[cls].push(drawPlaceholder(cls));
  return lib;
};

/** Непрозрачность и цвета картинки в разрешении маски. Строки переворачиваются: в маске строка 0 — низ. */
const sampleForMask = (image: HTMLCanvasElement, mw: number, mh: number) => {
  const small = document.createElement('canvas');
  small.width = mw;
  small.height = mh;
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, mw, mh);
  const data = g.getImageData(0, 0, mw, mh).data;
  const opaque = new Uint8Array(mw * mh);
  const colors = new Uint8Array(mw * mh * 3);
  for (let row = 0; row < mh; row++) {
    for (let col = 0; col < mw; col++) {
      const src = (row * mw + col) * 4;
      const dst = (mh - 1 - row) * mw + col;
      opaque[dst] = data[src + 3] > OPAQUE_ALPHA ? 1 : 0;
      colors[dst * 3] = data[src];
      colors[dst * 3 + 1] = data[src + 1];
      colors[dst * 3 + 2] = data[src + 2];
    }
  }
  return { opaque, colors };
};

/** Memory Object из картинки: размер по классу (равная площадь), маска — из альфы картинки. */
export const buildObject = (
  center: Vec2,
  source: CanvasArt,
  classes: Record<ObjectClass, ObjectClassDef>,
  playerDiameter: number,
  pixelsPerUnit: number,
  chunkIndex = 0,
  rng: () => number = Math.random,
): BuiltObject => {
  const def = classes[source.cls];
  const { width, height } = artSize(def.size, playerDiameter, source.aspect);
  const { w, h } = maskSize(width, height, pixelsPerUnit);
  const { opaque, colors } = sampleForMask(source.image, w, h);
  const object = createRootObject({
    cls: source.cls,
    center,
    width,
    height,
    value: objectValue(def.value, chunkIndex),
    opaque,
    maskWidth: w,
    maskHeight: h,
    phase: [rng() * 7, rng() * 7, rng() * 7, rng() * 7],
  });
  return { object, art: { colors, maskWidth: w } };
};
