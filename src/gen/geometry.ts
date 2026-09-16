import type { CellRect, ChunkLayout, CorridorSpec, RoomSpec } from './layout';

export type CorridorAxis = 'horizontal' | 'vertical';

/**
 * Конец хода у зала. Ход «докапывается» внутрь зала от клетки `along` в направлении `dir`
 * (по оси хода), пока не упрётся в пол зала: так он доходит до неровного края пещеры.
 */
export interface CorridorEnd {
  room: string;
  along: number;
  dir: -1 | 1;
  lateral: number;
}

export interface CorridorGeometry {
  axis: CorridorAxis;
  width: number;
  /** Прямоугольники хода в зазоре между залами: один прямой или три для излома. */
  rects: CellRect[];
  ends: [CorridorEnd, CorridorEnd];
}

const span = (from: number, len: number) => ({ from, to: from + len });

/**
 * Геометрия хода между двумя залами. Ход идёт по той оси, по которой залы разнесены.
 * Если стороны залов перекрываются на ширину хода и излом не задан — ход прямой по середине перекрытия.
 * Иначе у каждого зала ход выходит из середины его стороны (+offset / +offset+jog) и посередине
 * зазора делает Z-образный излом. Бросает ошибку с понятным текстом, если так соединить нельзя.
 */
export const corridorGeometry = (a: RoomSpec, b: RoomSpec, c: CorridorSpec): CorridorGeometry => {
  const ra = a.rect;
  const rb = b.rect;
  const name = `Ход ${c.a}–${c.b}`;
  const horizontal = Math.max(ra.x, rb.x) >= Math.min(ra.x + ra.w, rb.x + rb.w);
  const vertical = Math.max(ra.y, rb.y) >= Math.min(ra.y + ra.h, rb.y + rb.h);
  if (!horizontal && !vertical) throw new Error(`${name}: залы перекрываются`);
  if (horizontal && vertical) throw new Error(`${name}: залы стоят по диагонали`);

  // Приводим к «первый — слева/сверху». along — ось хода, lat — поперечная ось.
  const firstIsA = horizontal ? ra.x < rb.x : ra.y < rb.y;
  const [f, s] = firstIsA ? [ra, rb] : [rb, ra];
  const fAlong = horizontal ? span(f.x, f.w) : span(f.y, f.h);
  const sAlong = horizontal ? span(s.x, s.w) : span(s.y, s.h);
  const fLat = horizontal ? span(f.y, f.h) : span(f.x, f.w);
  const sLat = horizontal ? span(s.y, s.h) : span(s.x, s.w);
  const gapFrom = fAlong.to;
  const gapTo = sAlong.from;
  const gap = gapTo - gapFrom;
  if (gap < 1) throw new Error(`${name}: между залами нет стены`);

  const w = c.width;
  const offset = c.offset ?? 0;
  const overlap = { from: Math.max(fLat.from, sLat.from), to: Math.min(fLat.to, sLat.to) };
  let latF: number;
  let latS: number;
  if (c.jog === undefined && overlap.to - overlap.from >= w) {
    latF = latS = Math.floor(overlap.from + (overlap.to - overlap.from - w) / 2) + offset;
  } else {
    latF = Math.floor(fLat.from + (fLat.to - fLat.from - w) / 2) + offset;
    latS = c.jog === undefined ? Math.floor(sLat.from + (sLat.to - sLat.from - w) / 2) : latF + c.jog;
  }
  if (latF < fLat.from || latF + w > fLat.to) throw new Error(`${name}: выход за сторону первого зала (сдвиг ${offset})`);
  if (latS < sLat.from || latS + w > sLat.to) throw new Error(`${name}: выход за сторону второго зала (излом)`);

  const rect = (along0: number, alongLen: number, lat0: number, latLen: number): CellRect =>
    horizontal ? { x: along0, y: lat0, w: alongLen, h: latLen } : { x: lat0, y: along0, w: latLen, h: alongLen };

  let rects: CellRect[];
  if (latF === latS) {
    rects = [rect(gapFrom, gap, latF, w)];
  } else {
    // Излом: первый отрезок, поперечная перемычка шириной w, второй отрезок.
    const mid = gapFrom + Math.floor((gap - w) / 2);
    if (gap < w) throw new Error(`${name}: зазор ${gap} клеток мал для излома хода шириной ${w}`);
    const lo = Math.min(latF, latS);
    const hi = Math.max(latF, latS) + w;
    rects = [rect(gapFrom, mid - gapFrom, latF, w), rect(mid, w, lo, hi - lo), rect(mid + w, gapTo - mid - w, latS, w)].filter(
      (r) => r.w > 0 && r.h > 0,
    );
  }

  const [fid, sid] = firstIsA ? [c.a, c.b] : [c.b, c.a];
  return {
    axis: horizontal ? 'horizontal' : 'vertical',
    width: w,
    rects,
    ends: [
      { room: fid, along: gapFrom - 1, dir: -1, lateral: latF },
      { room: sid, along: gapTo, dir: 1, lateral: latS },
    ],
  };
};

export const roomById = (layout: ChunkLayout): Map<string, RoomSpec> => new Map(layout.rooms.map((r) => [r.id, r]));

export const corridorGeometries = (layout: ChunkLayout): CorridorGeometry[] => {
  const rooms = roomById(layout);
  return layout.corridors.map((c) => {
    const a = rooms.get(c.a);
    const b = rooms.get(c.b);
    if (!a || !b) throw new Error(`Ход ${c.a}–${c.b}: нет такого зала`);
    return corridorGeometry(a, b, c);
  });
};

/** Средняя точка хода (в клетках) — для отладки и кластеров осколков. */
export const corridorMid = (g: CorridorGeometry): { x: number; y: number } => {
  const r = g.rects[Math.floor(g.rects.length / 2)];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
