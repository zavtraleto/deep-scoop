import { baseRoom, slotRoom, type ChunkLayout, type CorridorSpec } from './layout';

const S = 12; // слот 12×12 клеток: залы 5–10, между залами всегда стена и ход
type RoomOpts = Parameters<typeof slotRoom>[5];
const room = (sx: number, sy: number, w: number, h: number, opts?: RoomOpts) => slotRoom(S, sx, sy, w, h, opts);
const blob = (sx: number, sy: number, w: number, h: number, opts?: RoomOpts) =>
  slotRoom(S, sx, sy, w, h, { ...opts, shape: 'blob' });
const link = (a: string, b: string, width: number, opts: { offset?: number; jog?: number } = {}): CorridorSpec => ({
  a,
  b,
  width,
  ...opts,
});

/**
 * Этап 3: ручная карта одного чанка 4×6 слотов (48×72 клетки) — «нора»:
 * залы разной формы и размера, смещённые в слотах (ходы разной длины), часть ходов с изломом,
 * параллельные ходы, острова и колонны в залах. Из полного графа соседей убрано ~14% рёбер —
 * у залов по 2–5 выходов, мостов нет (проверяется тестом).
 */
export const stage3Layout = (): ChunkLayout => ({
  slotsX: 4,
  slotsY: 6,
  slotSize: S,
  rooms: [
    baseRoom(S, 4, 0, 8),
    // Ряд 1
    blob(0, 1, 9, 7, { ox: 1, oy: 2, objects: ['medium'] }),
    room(1, 1, 6, 6, { ox: 4, oy: 4 }),
    blob(2, 1, 10, 9, { ox: 1, oy: 1, objects: ['large'] }),
    blob(3, 1, 7, 8, { ox: 3, oy: 2, objects: ['small'] }),
    // Ряд 2
    blob(0, 2, 8, 10, { ox: 2, oy: 1, islands: [{ x: 3, y: 4, w: 2, h: 3 }], objects: [{ cls: 'small', dx: -2.5, dy: 0 }] }),
    blob(1, 2, 10, 8, { ox: 1, oy: 2, objects: ['large'] }),
    room(2, 2, 5, 6, { ox: 5, oy: 3 }),
    blob(3, 2, 9, 9, { ox: 2, oy: 1, islands: [{ x: 5, y: 2, w: 2, h: 2 }], objects: [{ cls: 'medium', dx: -2, dy: 1 }] }),
    // Ряд 3
    blob(0, 3, 6, 9, { ox: 3, oy: 2, objects: ['small'] }),
    room(1, 3, 7, 5, { ox: 2, oy: 5 }),
    blob(2, 3, 10, 10, {
      ox: 1,
      oy: 1,
      islands: [
        { x: 2, y: 2, w: 2, h: 2 },
        { x: 6, y: 6, w: 2, h: 2 },
      ],
      objects: [{ cls: 'medium', dx: 2, dy: -2 }],
    }),
    blob(3, 3, 6, 7, { ox: 4, oy: 3, objects: ['small'] }),
    // Ряд 4
    blob(0, 4, 10, 9, { ox: 1, oy: 1, objects: ['large'] }),
    room(1, 4, 5, 5, { ox: 4, oy: 6 }),
    blob(2, 4, 8, 7, {
      ox: 2,
      oy: 3,
      islands: [{ x: 3, y: 2, w: 2, h: 3 }],
      objects: [
        { cls: 'small', dx: -2.5, dy: 0 },
        { cls: 'small', dx: 2.5, dy: 0 },
      ],
    }),
    blob(3, 4, 9, 10, { ox: 2, oy: 1, objects: ['large'] }),
    // Ряд 5
    blob(0, 5, 7, 6, { ox: 2, oy: 3, objects: ['small'] }),
    blob(1, 5, 10, 10, { ox: 1, oy: 1, islands: [{ x: 4, y: 4, w: 3, h: 2 }], objects: [{ cls: 'medium', dx: 0, dy: -3 }] }),
    blob(2, 5, 6, 9, { ox: 3, oy: 2, enemies: ['hunter'] }),
    blob(3, 5, 9, 8, { ox: 2, oy: 2, objects: ['medium', 'small'] }),
  ],
  corridors: [
    // 0–3: база ↔ ряд 1
    link('base', 'r01', 3),
    link('base', 'r11', 2),
    link('base', 'r21', 4),
    link('base', 'r31', 3),
    // 4–5: ряд 1
    link('r01', 'r11', 3, { jog: 2 }),
    link('r21', 'r31', 3),
    // 6–9: ряд 1 ↔ 2
    link('r01', 'r02', 3),
    link('r11', 'r12', 2),
    link('r21', 'r22', 3),
    link('r31', 'r32', 4),
    // 10–13: ряд 2 (между r12 и r22 — два параллельных хода)
    link('r02', 'r12', 4),
    link('r12', 'r22', 2, { offset: 2 }),
    link('r12', 'r22', 2, { offset: -2 }),
    link('r22', 'r32', 3),
    // 14–16: ряд 2 ↔ 3
    link('r02', 'r03', 3),
    link('r12', 'r13', 3, { jog: 2 }),
    link('r32', 'r33', 3),
    // 17–20: ряд 3 (между r23 и r33 — два хода, разделённые колонной)
    link('r03', 'r13', 2),
    link('r13', 'r23', 3),
    link('r23', 'r33', 3, { offset: -1 }),
    link('r23', 'r33', 2, { offset: 3 }),
    // 21–23: ряд 3 ↔ 4
    link('r03', 'r04', 2),
    link('r13', 'r14', 3),
    link('r33', 'r34', 3),
    // 24–25: ряд 4
    link('r04', 'r14', 3),
    link('r24', 'r34', 3),
    // 26–28: ряд 4 ↔ 5
    link('r04', 'r05', 3),
    link('r24', 'r25', 3),
    link('r34', 'r35', 4),
    // 29–31: ряд 5
    link('r05', 'r15', 3),
    link('r15', 'r25', 3),
    link('r25', 'r35', 2, { jog: 3 }),
  ],
});
