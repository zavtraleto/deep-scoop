import { clamp, type Vec2 } from '../math/vec2';
import { EraseMask } from './eraseMask';
import { MemoryObject, type ObjectSample } from './memoryObject';

export interface Component {
  label: number;
  size: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sumX: number;
  sumY: number;
}

/**
 * Связные (4-соседство) области нестёртых непрозрачных пикселей маски.
 * labels[i] — номер области пикселя или −1.
 */
export const findComponents = (mask: EraseMask): { labels: Int32Array; components: Component[] } => {
  const { width: w, height: h, opaque, erased } = mask;
  const labels = new Int32Array(w * h).fill(-1);
  const components: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1 || !opaque[start] || erased[start]) continue;
    const c: Component = { label: components.length, size: 0, minX: w, maxX: 0, minY: h, maxY: 0, sumX: 0, sumY: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = c.label;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      c.size++;
      c.sumX += x;
      c.sumY += y;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      const push = (j: number) => {
        if (labels[j] === -1 && opaque[j] && !erased[j]) {
          labels[j] = c.label;
          stack[top++] = j;
        }
      };
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    components.push(c);
  }
  return { labels, components };
};

export interface FractureParams {
  /** Куски меньше этой площади (ед.²) рассыпаются в груз. */
  minPieceArea: number;
  /** Скорость разлёта куска эталонной площади, ед./с. */
  splitSpeed: number;
  /** Площадь, для которой разлёт равен splitSpeed; меньшие куски летят быстрее, большие — медленнее. */
  splitRefArea: number;
  /** Доля скорости игрока, которую получают куски. */
  splitInherit: number;
  /** Угловая скорость куска эталонной площади при расколе, рад/с. */
  splitSpin: number;
  /** Сколько частиц выпустить вдоль разреза с каждого куска. */
  burstPerPiece: number;
}

export interface Cut {
  /** Точка на линии разреза (игрок). */
  point: Vec2;
  /** Единичное направление разреза (движение игрока). */
  dir: Vec2;
  /** Скорость игрока. */
  playerVel: Vec2;
}

export interface FractureResult {
  /** null — объект остался целым (возможно, без крошек); массив — объект заменяется этими кусками. */
  pieces: MemoryObject[] | null;
  /** Непрозрачные пиксели крошек, рассыпанных в груз. */
  crumbPixels: number;
  crumbSamples: ObjectSample[];
  /** Частицы вспышки вдоль разреза. */
  burstSamples: ObjectSample[];
}

const randomPhase = (rng: () => number): [number, number, number, number] => [
  rng() * Math.PI * 2,
  rng() * Math.PI * 2,
  rng() * Math.PI * 2,
  rng() * Math.PI * 2,
];

/**
 * Проверить объект на раскол (§ решения этапа 3 с пользователем):
 * - мелкие острова (< minPieceArea) рассыпаются — их пиксели стираются и идут в груз;
 * - если крупных областей две и больше — объект заменяется кусками. Каждый кусок — вырезка маски
 *   со своим телом: медленно расходится от линии разреза, едва заметно вращается;
 * - если крупных областей не осталось — объект извлечён целиком и исчезает.
 */
export const fracture = (
  obj: MemoryObject,
  cut: Cut,
  p: FractureParams,
  rng: () => number,
  maxCrumbSamples = 12,
): FractureResult => {
  const { mask } = obj;
  const { labels, components } = findComponents(mask);
  const pixelArea = obj.pixelW * obj.pixelH;
  const big = components.filter((c) => c.size * pixelArea >= p.minPieceArea);
  const crumbs = components.filter((c) => c.size * pixelArea < p.minPieceArea);
  const result: FractureResult = { pieces: null, crumbPixels: 0, crumbSamples: [], burstSamples: [] };

  if (crumbs.length > 0) {
    const isCrumb = new Uint8Array(components.length);
    for (const c of crumbs) isCrumb[c.label] = 1;
    const stride = Math.max(1, Math.floor(crumbs.reduce((s, c) => s + c.size, 0) / maxCrumbSamples));
    let seen = 0;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l < 0 || !isCrumb[l]) continue;
      if (seen++ % stride === 0 && result.crumbSamples.length < maxCrumbSamples) {
        const px = i % mask.width;
        const py = (i - px) / mask.width;
        result.crumbSamples.push({ px, py, ...obj.maskToWorld(px, py), object: obj });
      }
      if (mask.eraseAt(i)) result.crumbPixels++;
    }
  }

  if (big.length === 0) {
    result.pieces = [];
    return result;
  }
  if (big.length === 1) return result;

  const parentPos = obj.body.pos;
  result.pieces = big.map((c, index) => {
    // Вырезка с запасом в пиксель: светящийся край разреза не упирается в границу текстуры.
    const x0 = Math.max(0, c.minX - 1);
    const y0 = Math.max(0, c.minY - 1);
    const x1 = Math.min(mask.width - 1, c.maxX + 1);
    const y1 = Math.min(mask.height - 1, c.maxY + 1);
    const pw = x1 - x0 + 1;
    const ph = y1 - y0 + 1;
    const opaque = new Uint8Array(pw * ph);
    const erased = new Uint8Array(pw * ph);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * mask.width + x;
        const j = (y - y0) * pw + (x - x0);
        opaque[j] = mask.opaque[i];
        // Чужие куски внутри вырезки должны быть невидимы: помечаем их стёртыми.
        erased[j] = mask.erased[i] || (mask.opaque[i] && labels[i] !== c.label) ? 255 : 0;
      }
    }

    const cx = c.sumX / c.size + 0.5; // центр масс в непрерывных координатах маски родителя
    const cy = c.sumY / c.size + 0.5;
    const center = obj.maskPointToWorld(cx, cy);
    const area = c.size * pixelArea;
    const scale = clamp(Math.sqrt(p.splitRefArea / area), 0.6, 1.8);

    // Сторона разреза: куски расходятся перпендикулярно пути игрока и немного — от центра объекта.
    const side = Math.sign(cut.dir.x * (center.y - cut.point.y) - cut.dir.y * (center.x - cut.point.x)) || (index % 2 ? 1 : -1);
    let dx = -cut.dir.y * side * 0.75;
    let dy = cut.dir.x * side * 0.75;
    const ox = center.x - parentPos.x;
    const oy = center.y - parentPos.y;
    const ol = Math.hypot(ox, oy);
    if (ol > 1e-6) {
      dx += (ox / ol) * 0.25;
      dy += (oy / ol) * 0.25;
    }
    const dl = Math.hypot(dx, dy) || 1;
    const speed = p.splitSpeed * scale;

    const piece = new MemoryObject({
      cls: obj.cls,
      root: obj.root,
      mask: new EraseMask(pw, ph, opaque, erased),
      pixelW: obj.pixelW,
      pixelH: obj.pixelH,
      offsetX: obj.offsetX + x0,
      offsetY: obj.offsetY + y0,
      pivot: { x: (cx - x0) * obj.pixelW, y: (cy - y0) * obj.pixelH },
      pos: center,
      angle: obj.body.angle,
      vel: {
        x: obj.body.vel.x + (dx / dl) * speed + cut.playerVel.x * p.splitInherit,
        y: obj.body.vel.y + (dy / dl) * speed + cut.playerVel.y * p.splitInherit,
      },
      angVel: obj.body.angVel + side * p.splitSpin * scale * (0.75 + rng() * 0.5),
      drifting: true,
      phase: randomPhase(rng),
    });

    // Вспышка: несколько пикселей куска у линии разреза.
    const stride = Math.max(1, Math.floor(c.size / 400));
    let taken = 0;
    for (let y = y0; y <= y1 && taken < p.burstPerPiece; y++) {
      for (let x = x0; x <= x1 && taken < p.burstPerPiece; x += stride) {
        if (labels[y * mask.width + x] !== c.label || rng() > 0.08) continue;
        const w = obj.maskToWorld(x, y);
        const dist = Math.abs(cut.dir.x * (w.y - cut.point.y) - cut.dir.y * (w.x - cut.point.x));
        if (dist > 0.9) continue;
        result.burstSamples.push({ px: x - x0, py: y - y0, ...w, object: piece });
        taken++;
      }
    }
    return piece;
  });
  return result;
};
