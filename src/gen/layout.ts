import type { ObjectClass } from '../collect/memoryObject';

/**
 * Раскладка чанка (§4.2–4.3, решения пользователя: чанки и залы крупнее, форма и размеры разные,
 * у залов много входов, внутри бывают острова). Всё в клетках чанка: x вправо, y вниз (как у Grid).
 * Раскладка — данные, растеризует её buildChunk.ts. Сюда же позже придут кастомные комнаты
 * и случайный генератор (§4.5).
 */

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RoomKind = 'room' | 'base';

/** rect — прямоугольный зал; blob — неровный «пещерный» эллипс, форма зависит от id. */
export type RoomShape = 'rect' | 'blob';

/** Объект в зале. dx, dy — смещение от центра зала в клетках (y вниз); по умолчанию — авторасстановка. */
export type ObjectSpec = ObjectClass | { cls: ObjectClass; dx: number; dy: number };

export interface RoomSpec {
  id: string;
  kind: RoomKind;
  shape: RoomShape;
  /** Габарит зала в клетках чанка. */
  rect: CellRect;
  /** Слот, которому принадлежит зал (у базы — левый слот её ряда). */
  slot: { sx: number; sy: number };
  /** Сплошные острова и колонны внутри зала, координаты от левого верхнего угла габарита. */
  islands?: CellRect[];
  /** Какие Memory Objects поставить в зал (0–2, §7). */
  objects?: ObjectSpec[];
}

export interface CorridorSpec {
  a: string;
  b: string;
  /** Ширина хода в клетках (2–4). */
  width: number;
  /** Сдвиг хода у первой (левой/верхней) комнаты от середины, клетки. */
  offset?: number;
  /** Дополнительный сдвиг у второй комнаты: ход получает излом посередине. */
  jog?: number;
}

export type ShardAnchor =
  | { corridor: number }
  | { room: string; edge: 'top' | 'bottom' | 'left' | 'right' };

/** Кластер осколков (§8): в ходе или вдоль края зала. */
export interface ShardCluster {
  at: ShardAnchor;
  count: number;
}

export interface ChunkLayout {
  slotsX: number;
  slotsY: number;
  slotSize: number;
  rooms: RoomSpec[];
  corridors: CorridorSpec[];
  shards: ShardCluster[];
}

export const chunkSize = (l: ChunkLayout) => ({ w: l.slotsX * l.slotSize, h: l.slotsY * l.slotSize });

export const objectClass = (o: ObjectSpec): ObjectClass => (typeof o === 'string' ? o : o.cls);

/**
 * Зал в слоте (sx, sy) размером w×h. Смещение ox/oy внутри слота; по умолчанию — по центру.
 * Между залом и краем слота остаётся минимум клетка стены (проверяет validate).
 */
export const slotRoom = (
  slotSize: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
  opts: { ox?: number; oy?: number; shape?: RoomShape; islands?: CellRect[]; objects?: ObjectSpec[] } = {},
): RoomSpec => ({
  id: `r${sx}${sy}`,
  kind: 'room',
  shape: opts.shape ?? 'rect',
  rect: {
    x: sx * slotSize + (opts.ox ?? Math.floor((slotSize - w) / 2)),
    y: sy * slotSize + (opts.oy ?? Math.floor((slotSize - h) / 2)),
    w,
    h,
  },
  slot: { sx, sy },
  islands: opts.islands,
  objects: opts.objects,
});

/** База (§4.7): весь ряд слотов sy одной широкой комнатой высотой h. */
export const baseRoom = (slotSize: number, slotsX: number, sy: number, h: number): RoomSpec => ({
  id: 'base',
  kind: 'base',
  shape: 'rect',
  rect: { x: 1, y: sy * slotSize + (slotSize - h - 1), w: slotsX * slotSize - 2, h },
  slot: { sx: 0, sy },
});
