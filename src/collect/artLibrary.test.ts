import { describe, expect, it } from 'vitest';
import { alphaBounds, artSize, classFromPath, nameFromPath, pickArt, type ArtSource } from './artLibrary';

describe('картинки объектов', () => {
  it('размер по равной площади: пропорции из картинки, площадь от класса', () => {
    const square = artSize(2, 1, 1);
    const tall = artSize(2, 1, 0.5);
    const wide = artSize(2, 1, 2);
    expect(square).toEqual({ width: 2, height: 2 });
    for (const s of [tall, wide]) expect(s.width * s.height).toBeCloseTo(4, 9);
    expect(tall.width / tall.height).toBeCloseTo(0.5, 9);
    expect(wide.width / wide.height).toBeCloseTo(2, 9);
  });

  it('обрезка по альфе находит габарит и игнорирует полупрозрачный ореол', () => {
    const w = 6;
    const h = 5;
    const rgba = new Uint8Array(w * h * 4);
    const setA = (x: number, y: number, a: number) => (rgba[(y * w + x) * 4 + 3] = a);
    setA(0, 0, 50); // ореол ниже порога
    setA(2, 1, 255);
    setA(4, 3, 200);
    expect(alphaBounds(rgba, w, h, 96)).toEqual({ x: 2, y: 1, w: 3, h: 3 });
    expect(alphaBounds(new Uint8Array(w * h * 4), w, h, 96)).toBeNull();
  });

  it('класс и имя берутся из пути', () => {
    expect(classFromPath('../assets/objects/small/phone.png')).toBe('small');
    expect(classFromPath('../assets/objects/Large/tv.webp')).toBe('large');
    expect(classFromPath('../assets/objects/other/x.png')).toBeNull();
    expect(nameFromPath('../assets/objects/medium/old.chair.png')).toBe('old.chair');
  });

  it('выбор картинки детерминирован и уважает явное имя', () => {
    const list: ArtSource<null>[] = ['a', 'b', 'c'].map((name) => ({ name, cls: 'small', image: null, aspect: 1 }));
    expect(pickArt(list, 'room-3#0')).toBe(pickArt(list, 'room-3#0'));
    const picked = new Set(Array.from({ length: 40 }, (_, i) => pickArt(list, `r${i}#0`)!.name));
    expect(picked.size).toBe(3);
    expect(pickArt(list, 'x', 'b')!.name).toBe('b');
    expect(pickArt(list, 'x', 'нет-такой')).toBeDefined();
    expect(pickArt([], 'x')).toBeUndefined();
  });
});
