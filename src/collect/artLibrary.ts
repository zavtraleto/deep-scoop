import type { ObjectClass } from './memoryObject';

/**
 * Библиотека картинок Memory Objects (§7). Картинки — PNG/WebP пользователя из
 * `src/assets/objects/<класс>/`; класс задаётся папкой. Здесь — чистая логика без DOM:
 * размер в мире, обрезка прозрачных полей, выбор картинки для места в карте.
 */

/** Картинка, готовая к использованию. image — обрезанный по альфе холст (или любая рисуемая картинка). */
export interface ArtSource<Image = unknown> {
  /** Имя файла без расширения — по нему картинку можно задать в ручной карте. */
  name: string;
  cls: ObjectClass;
  image: Image;
  /** Ширина / высота. */
  aspect: number;
}

export type ArtLibrary<Image = unknown> = Record<ObjectClass, ArtSource<Image>[]>;

/**
 * Размер в мире по правилу «равной площади» (решение пользователя): площадь любого предмета класса
 * равна квадрату со стороной size · диаметр игрока, пропорции берутся из картинки.
 * Так узкий телефон и широкая книга стираются примерно одинаково долго при одинаковой ценности.
 */
export const artSize = (classSize: number, playerDiameter: number, aspect: number) => {
  const side = classSize * playerDiameter;
  const k = Math.sqrt(aspect);
  return { width: side * k, height: side / k };
};

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Габарит пикселей с альфой выше порога (RGBA, строка 0 — верх). null — картинка пустая. */
export const alphaBounds = (rgba: ArrayLike<number>, w: number, h: number, threshold: number): PixelRect | null => {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

/** Класс по имени папки из пути вида `.../objects/small/phone.png`. */
export const classFromPath = (path: string): ObjectClass | null => {
  const m = /\/(small|medium|large)\/[^/]+$/i.exec(path);
  return m ? (m[1].toLowerCase() as ObjectClass) : null;
};

/** Имя файла без папки и расширения. */
export const nameFromPath = (path: string): string => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/**
 * Картинка для места в карте. Явно заданное имя (ручная карта) — если такая есть в классе;
 * иначе выбор детерминирован по ключу места: при перезапуске уровня предметы не меняются.
 */
export const pickArt = <Image>(list: readonly ArtSource<Image>[], key: string, name?: string): ArtSource<Image> | undefined => {
  if (list.length === 0) return undefined;
  if (name) {
    const named = list.find((a) => a.name === name);
    if (named) return named;
  }
  return list[hashString(key) % list.length];
};
