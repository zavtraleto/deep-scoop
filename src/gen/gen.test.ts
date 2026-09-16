import { describe, expect, it } from 'vitest';
import { CELL } from '../core/config';
import { Cell } from '../world/grid';
import { buildChunk } from './buildChunk';
import { corridorGeometry } from './geometry';
import { stage3Layout } from './handLayouts';
import { slotRoom, type ChunkLayout } from './layout';
import { findBridges, validateLayout } from './validate';

describe('мосты (Тарьян)', () => {
  it('цикл без мостов, хвост — мост', () => {
    expect(findBridges(3, [[0, 1], [1, 2], [2, 0]])).toEqual([]);
    expect(findBridges(4, [[0, 1], [1, 2], [2, 0], [2, 3]])).toEqual([3]);
  });

  it('два параллельных ребра — не мост', () => {
    expect(findBridges(2, [[0, 1], [0, 1]])).toEqual([]);
  });
});

describe('геометрия прохода', () => {
  it('горизонтальный проход между соседями по ряду', () => {
    const a = slotRoom(9, 0, 1, 5, 5);
    const b = slotRoom(9, 1, 1, 5, 5);
    const g = corridorGeometry(a, b, { a: a.id, b: b.id, width: 3 });
    expect(g.axis).toBe('horizontal');
    expect(g.rects).toEqual([{ x: 7, y: 12, w: 4, h: 3 }]);
  });

  it('излом: ход смещается посередине зазора и остаётся непрерывным', () => {
    const a = slotRoom(9, 0, 1, 5, 5);
    const b = slotRoom(9, 1, 1, 5, 5);
    const g = corridorGeometry(a, b, { a: a.id, b: b.id, width: 2, jog: 2 });
    // Зазор 4 клетки: отрезок, перемычка шириной хода, отрезок — вместе покрывают весь зазор.
    expect(g.rects).toHaveLength(3);
    expect(g.rects.reduce((s, r) => s + r.w, 0)).toBe(4);
    expect(g.ends[0].lateral + 2).toBe(g.ends[1].lateral);
  });

  it('излом, который выводит ход за сторону зала, — понятная ошибка', () => {
    const a = slotRoom(9, 0, 1, 4, 4);
    const b = slotRoom(9, 1, 1, 4, 4);
    expect(() => corridorGeometry(a, b, { a: a.id, b: b.id, width: 2, jog: 3 })).toThrow(/второго зала/);
  });
});

describe('проверка раскладки §4.4', () => {
  const square = (): ChunkLayout => ({
    slotsX: 2,
    slotsY: 2,
    slotSize: 9,
    rooms: [slotRoom(9, 0, 0, 5, 5), slotRoom(9, 1, 0, 5, 5), slotRoom(9, 0, 1, 5, 5), slotRoom(9, 1, 1, 5, 5)],
    corridors: [
      { a: 'r00', b: 'r10', width: 2 },
      { a: 'r01', b: 'r11', width: 2 },
      { a: 'r00', b: 'r01', width: 2 },
      { a: 'r10', b: 'r11', width: 2 },
    ],
  });

  it('кольцо из четырёх комнат валидно', () => {
    expect(validateLayout(square())).toEqual([]);
  });

  it('тупик и мост находятся', () => {
    const l = square();
    l.corridors.pop();
    const problems = validateLayout(l);
    expect(problems.some((p) => p.includes('r11') && p.includes('минимум 2'))).toBe(true);
    expect(problems.some((p) => p.includes('мост'))).toBe(true);
  });

  it('Large в маленькой комнате — ошибка', () => {
    const l = square();
    l.rooms[0].objects = ['large'];
    expect(validateLayout(l).some((p) => p.includes('Large'))).toBe(true);
  });
});

describe('ручная карта этапа 3', () => {
  it('проходит все правила', () => {
    expect(validateLayout(stage3Layout())).toEqual([]);
  });

  it('у залов много выходов: в среднем не меньше трёх', () => {
    const l = stage3Layout();
    const degree = new Map<string, number>();
    for (const c of l.corridors) for (const id of [c.a, c.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const rooms = l.rooms.filter((r) => r.kind === 'room');
    const avg = rooms.reduce((s, r) => s + (degree.get(r.id) ?? 0), 0) / rooms.length;
    expect(avg).toBeGreaterThanOrEqual(3);
  });

  it('залы-капли неровные, острова — сплошные', () => {
    const map = buildChunk(stage3Layout());
    const r21 = map.layout.rooms.find((r) => r.id === 'r21')!;
    expect(map.grid.get(r21.rect.x, r21.rect.y)).toBe(Cell.Solid); // угол габарита — скала
    const r02 = map.layout.rooms.find((r) => r.id === 'r02')!;
    const isl = r02.islands![0];
    expect(map.grid.get(r02.rect.x + isl.x + 1, r02.rect.y + isl.y + 1)).toBe(Cell.Solid);
  });

  it('растеризуется: старт на базе в пустой клетке, объекты на полу', () => {
    const map = buildChunk(stage3Layout());
    expect(map.grid.width).toBe(48);
    expect(map.grid.height).toBe(72);
    const empty = (p: { x: number; y: number }) =>
      map.grid.get(Math.floor(p.x / CELL), Math.floor(-p.y / CELL)) === Cell.Empty;
    expect(empty(map.spawn)).toBe(true);
    expect(map.objects.length).toBeGreaterThan(10);
    for (const o of map.objects) expect(empty(o.center)).toBe(true);
  });

  it('все комнаты достижимы по клеткам от базы', () => {
    const map = buildChunk(stage3Layout());
    const { grid } = map;
    const start = { cx: Math.floor(map.spawn.x / CELL), cy: Math.floor(-map.spawn.y / CELL) };
    const seen = new Uint8Array(grid.width * grid.height);
    const stack = [start];
    seen[start.cy * grid.width + start.cx] = 1;
    while (stack.length) {
      const { cx, cy } = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!grid.inBounds(nx, ny) || seen[ny * grid.width + nx] || grid.get(nx, ny) !== Cell.Empty) continue;
        seen[ny * grid.width + nx] = 1;
        stack.push({ cx: nx, cy: ny });
      }
    }
    // Все клетки пола достижимы — нет замурованных карманов в залах с островами.
    for (let i = 0; i < seen.length; i++) {
      if (grid.cells[i] === Cell.Empty) expect(seen[i], `клетка ${i % grid.width},${Math.floor(i / grid.width)}`).toBe(1);
    }
  });
});
