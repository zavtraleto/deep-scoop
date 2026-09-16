import type { RoomSpec } from './layout';

/** Детерминированный генератор по строке: одна и та же комната всегда одной формы. */
export const seededRandom = (key: string) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let s = h >>> 0 || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 4294967296;
  };
};

/** Неровность края «пещерного» зала: радиус границы колеблется в этих пределах. */
const BLOB_WOBBLE = 0.3;

interface Lobe {
  cx: number;
  cy: number;
  radius: number;
  phases: number[];
}

/**
 * Пол зала без островов: маска w×h (1 — пол), строки сверху вниз.
 * blob — объединение основного эллипса и 1–2 «лопастей» со смещёнными центрами; у каждого
 * край колеблется по углу (сумма гармоник со случайными фазами). Получаются залы-бобы, почки, кляксы.
 */
export const roomFloorMask = (room: RoomSpec): Uint8Array => {
  const { w, h } = room.rect;
  const mask = new Uint8Array(w * h);
  if (room.shape === 'rect') return mask.fill(1);

  const rng = seededRandom(room.id);
  const phases = () => [rng(), rng(), rng()].map((v) => v * Math.PI * 2);
  const lobes: Lobe[] = [{ cx: 0, cy: 0, radius: 0.82, phases: phases() }];
  const extra = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < extra; k++) {
    const a = rng() * Math.PI * 2;
    const d = 0.4 + rng() * 0.15;
    lobes.push({ cx: Math.cos(a) * d, cy: Math.sin(a) * d, radius: 0.5 + rng() * 0.15, phases: phases() });
  }

  const inside = (lobe: Lobe, u: number, v: number) => {
    const du = u - lobe.cx;
    const dv = v - lobe.cy;
    const t = Math.atan2(dv, du);
    const p = lobe.phases;
    const n = 0.5 * Math.sin(2 * t + p[0]) + 0.3 * Math.sin(3 * t + p[1]) + 0.2 * Math.sin(5 * t + p[2]);
    return Math.hypot(du, dv) <= lobe.radius * (1 - BLOB_WOBBLE * (0.5 + 0.5 * n)) + 0.12;
  };

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = ((i + 0.5) / w) * 2 - 1;
      const v = ((j + 0.5) / h) * 2 - 1;
      if (lobes.some((l) => inside(l, u, v))) mask[j * w + i] = 1;
    }
  }
  return smoothCave(mask, w, h, 2);
};

/**
 * Сглаживание клеточным автоматом (как в классической генерации пещер): клетка становится полом,
 * если вокруг ≥ 5 из 8 соседей — пол, и скалой, если ≤ 3. Убирает одиночные заусенцы и щербины.
 */
const smoothCave = (mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array => {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(cur);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const x = i + di;
            const y = j + dj;
            if (x >= 0 && y >= 0 && x < w && y < h) n += cur[y * w + x];
          }
        }
        if (n >= 5) next[j * w + i] = 1;
        else if (n <= 3) next[j * w + i] = 0;
      }
    }
    cur = next;
  }
  return cur;
};
