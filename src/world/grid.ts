import { CELL } from '../core/config';
import type { Segment } from '../math/vec2';

/**
 * Типы клеток. Диагональные клетки наполовину твёрдые — ими срезаются углы под 45°.
 * Имя диагонали — угол, в котором лежит твёрдый треугольник (TL = верхний левый).
 */
export enum Cell {
  Empty = 0,
  Solid = 1,
  DiagTL = 2,
  DiagTR = 3,
  DiagBL = 4,
  DiagBR = 5,
}

enum Side {
  Top = 1,
  Right = 2,
  Bottom = 4,
  Left = 8,
}

/** Какие стороны клетки полностью закрыты твёрдым материалом. */
const solidSides = (c: Cell): number => {
  switch (c) {
    case Cell.Empty:
      return 0;
    case Cell.Solid:
      return Side.Top | Side.Right | Side.Bottom | Side.Left;
    case Cell.DiagTL:
      return Side.Top | Side.Left;
    case Cell.DiagTR:
      return Side.Top | Side.Right;
    case Cell.DiagBL:
      return Side.Bottom | Side.Left;
    case Cell.DiagBR:
      return Side.Bottom | Side.Right;
  }
};

/**
 * Сетка мира. Клетка (cx, cy): cy растёт вниз (глубже).
 * В мировых координатах клетка занимает x ∈ [cx·CELL, (cx+1)·CELL], y ∈ [-(cy+1)·CELL, -cy·CELL].
 */
export class Grid {
  readonly cells: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Cell = Cell.Solid,
  ) {
    this.cells = new Uint8Array(width * height).fill(fill);
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  /** За пределами сетки — сплошная стена. */
  get(cx: number, cy: number): Cell {
    return this.inBounds(cx, cy) ? (this.cells[cy * this.width + cx] as Cell) : Cell.Solid;
  }

  set(cx: number, cy: number, c: Cell): void {
    if (this.inBounds(cx, cy)) this.cells[cy * this.width + cx] = c;
  }

  carveRect(cx: number, cy: number, w: number, h: number): void {
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) this.set(x, y, Cell.Empty);
  }

  fillRect(cx: number, cy: number, w: number, h: number): void {
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) this.set(x, y, Cell.Solid);
  }

  /**
   * Срезать углы под 45° (§4.3).
   * Пустая клетка во внутреннем углу (твёрдые ровно два перпендикулярных соседа) становится диагональю.
   * Твёрдая клетка на внешнем углу (пустые ровно два перпендикулярных соседа) — тоже.
   * Угол срезается, только если обе образующие его стены продолжаются дальше угла хотя бы на клетку:
   * иначе на ступеньке в одну клетку внешний и внутренний срезы встают рядом и дают торчащий зубец.
   */
  cutCorners(): void {
    const src = this.cells.slice();
    const solidAt = (x: number, y: number): boolean =>
      this.inBounds(x, y) ? src[y * this.width + x] === Cell.Solid : true;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const solid = solidAt(x, y);
        // «Чужой» сосед — другого типа, чем сама клетка.
        const other = (dx: number, dy: number) => solidAt(x + dx, y + dy) !== solid;
        const u = other(0, -1);
        const d = other(0, 1);
        const l = other(-1, 0);
        const r = other(1, 0);
        // Угол: чужие соседи по направлениям A и B, свои — с противоположных сторон.
        let a: [number, number] | null = null;
        let b: [number, number] | null = null;
        let corner: 'TL' | 'TR' | 'BL' | 'BR' | null = null;
        if (u && l && !d && !r) [a, b, corner] = [[0, -1], [-1, 0], 'TL'];
        else if (u && r && !d && !l) [a, b, corner] = [[0, -1], [1, 0], 'TR'];
        else if (d && l && !u && !r) [a, b, corner] = [[0, 1], [-1, 0], 'BL'];
        else if (d && r && !u && !l) [a, b, corner] = [[0, 1], [1, 0], 'BR'];
        if (!a || !b || !corner) continue;
        // Стены-плечи угла продолжаются: клетки A−B и B−A тоже чужие.
        if (!other(a[0] - b[0], a[1] - b[1]) || !other(b[0] - a[0], b[1] - a[1])) continue;
        // Для пустой клетки твёрдый треугольник лежит в углу чужих соседей, для твёрдой — в противоположном.
        const flip = { TL: 'BR', TR: 'BL', BL: 'TR', BR: 'TL' } as const;
        const solidCorner = solid ? flip[corner] : corner;
        this.cells[y * this.width + x] = {
          TL: Cell.DiagTL,
          TR: Cell.DiagTR,
          BL: Cell.DiagBL,
          BR: Cell.DiagBR,
        }[solidCorner];
      }
    }
  }

  /**
   * Засыпать тупиковые зазубрины: пустые клетки, у которых скала с трёх сторон. Повторяется, пока
   * такие есть. Ходы уже двух клеток генератор не строит, поэтому настоящие проходы не страдают.
   */
  fillNotches(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          if (this.get(x, y) !== Cell.Empty) continue;
          const solid =
            (this.get(x - 1, y) === Cell.Solid ? 1 : 0) +
            (this.get(x + 1, y) === Cell.Solid ? 1 : 0) +
            (this.get(x, y - 1) === Cell.Solid ? 1 : 0) +
            (this.get(x, y + 1) === Cell.Solid ? 1 : 0);
          if (solid >= 3) {
            this.set(x, y, Cell.Solid);
            changed = true;
          }
        }
      }
    }
  }

  isPassable(cx: number, cy: number): boolean {
    return this.get(cx, cy) !== Cell.Solid;
  }

  /** Отрезки стен, разложенные по клеткам для быстрого поиска рядом с игроком. */
  buildWalls(): WallIndex {
    const buckets: Segment[][] = Array.from({ length: this.width * this.height }, () => []);
    const all: Segment[] = [];
    const add = (bx: number, by: number, s: Segment) => {
      all.push(s);
      if (this.inBounds(bx, by)) buckets[by * this.width + bx].push(s);
    };

    for (let cy = -1; cy < this.height; cy++) {
      for (let cx = -1; cx < this.width; cx++) {
        const x0 = cx * CELL;
        const x1 = (cx + 1) * CELL;
        const yTop = -cy * CELL;
        const yBot = -(cy + 1) * CELL;
        const here = solidSides(this.get(cx, cy));

        // Граница с правым соседом. Отрезок кладём в корзину пустой стороны.
        if (cy >= 0) {
          const right = solidSides(this.get(cx + 1, cy));
          const a = (here & Side.Right) !== 0;
          const b = (right & Side.Left) !== 0;
          if (a !== b) add(a ? cx + 1 : cx, cy, { ax: x1, ay: yTop, bx: x1, by: yBot });
        }
        // Граница с нижним соседом.
        if (cx >= 0) {
          const below = solidSides(this.get(cx, cy + 1));
          const a = (here & Side.Bottom) !== 0;
          const b = (below & Side.Top) !== 0;
          if (a !== b) add(cx, a ? cy + 1 : cy, { ax: x0, ay: yBot, bx: x1, by: yBot });
        }
      }
    }

    // Гипотенузы диагональных клеток.
    for (let cy = 0; cy < this.height; cy++) {
      for (let cx = 0; cx < this.width; cx++) {
        const c = this.get(cx, cy);
        const x0 = cx * CELL;
        const x1 = (cx + 1) * CELL;
        const yTop = -cy * CELL;
        const yBot = -(cy + 1) * CELL;
        if (c === Cell.DiagTL || c === Cell.DiagBR) add(cx, cy, { ax: x0, ay: yBot, bx: x1, by: yTop });
        else if (c === Cell.DiagTR || c === Cell.DiagBL) add(cx, cy, { ax: x0, ay: yTop, bx: x1, by: yBot });
      }
    }

    return new WallIndex(this.width, this.height, buckets, all);
  }
}

export class WallIndex {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly buckets: Segment[][],
    readonly all: Segment[],
  ) {}

  /** Отрезки стен, границы которых лежат на клетке (cx, cy). */
  inCell(cx: number, cy: number): readonly Segment[] {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height ? this.buckets[cy * this.width + cx] : [];
  }

  /** Отрезки стен в клетках вокруг круга (x, y, r). Без повторов. */
  near(x: number, y: number, r: number, out: Segment[] = []): Segment[] {
    out.length = 0;
    const cx0 = Math.max(Math.floor((x - r) / CELL) - 1, 0);
    const cx1 = Math.min(Math.floor((x + r) / CELL) + 1, this.width - 1);
    const cy0 = Math.max(Math.floor(-(y + r) / CELL) - 1, 0);
    const cy1 = Math.min(Math.floor(-(y - r) / CELL) + 1, this.height - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const s of this.buckets[cy * this.width + cx]) {
          if (!out.includes(s)) out.push(s);
        }
      }
    }
    return out;
  }
}
