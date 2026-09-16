import { corridorGeometry, roomById } from './geometry';
import { objectClass, type ChunkLayout } from './layout';

/**
 * Мосты графа алгоритмом Тарьяна: рёбра, удаление которых разрывает граф (§4.4, §4.5).
 * Кратные рёбра учитываются по индексу, а не по паре вершин.
 */
export const findBridges = (nodeCount: number, edges: readonly [number, number][]): number[] => {
  const adj: { to: number; edge: number }[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach(([a, b], i) => {
    adj[a].push({ to: b, edge: i });
    adj[b].push({ to: a, edge: i });
  });
  const tin = new Array<number>(nodeCount).fill(-1);
  const low = new Array<number>(nodeCount).fill(0);
  const bridges: number[] = [];
  let timer = 0;

  const dfs = (v: number, parentEdge: number) => {
    tin[v] = low[v] = timer++;
    for (const { to, edge } of adj[v]) {
      if (edge === parentEdge) continue;
      if (tin[to] !== -1) {
        low[v] = Math.min(low[v], tin[to]);
      } else {
        dfs(to, edge);
        low[v] = Math.min(low[v], low[to]);
        if (low[to] > tin[v]) bridges.push(edge);
      }
    }
  };
  for (let v = 0; v < nodeCount; v++) if (tin[v] === -1) dfs(v, -1);
  return bridges;
};

/** Связность графа: все вершины достижимы из первой. */
const isConnected = (nodeCount: number, edges: readonly [number, number][]): boolean => {
  if (nodeCount === 0) return true;
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) for (const n of adj[stack.pop()!]) if (!seen.has(n) && seen.add(n)) stack.push(n);
  return seen.size === nodeCount;
};

/**
 * Проверка раскладки. Возвращает список проблем; пустой список — раскладка валидна.
 * - комнаты внутри своих слотов, между комнатой и краем слота есть стена;
 * - каждый проход геометрически возможен;
 * - граф связен, у каждой комнаты ≥ 2 прохода, мостов нет (§4.4);
 * - Large ставится только в комнаты от 6×6 (§7).
 */
export const validateLayout = (layout: ChunkLayout): string[] => {
  const problems: string[] = [];
  const rooms = roomById(layout);
  const S = layout.slotSize;

  for (const r of layout.rooms) {
    const { x, y, w, h } = r.rect;
    if (r.kind === 'room') {
      const sx0 = r.slot.sx * S;
      const sy0 = r.slot.sy * S;
      if (x < sx0 + 1 || y < sy0 + 1 || x + w > sx0 + S - 1 || y + h > sy0 + S - 1) {
        problems.push(`Комната ${r.id} выходит за свой слот или касается его края`);
      }
      if (r.objects?.some((o) => objectClass(o) === 'large') && Math.min(w, h) < 6) {
        problems.push(`Комната ${r.id} ${w}×${h} мала для Large-объекта (нужно от 6×6)`);
      }
    }
    for (const isl of r.islands ?? []) {
      if (isl.x < 1 || isl.y < 1 || isl.x + isl.w > w - 1 || isl.y + isl.h > h - 1) {
        problems.push(`Остров в зале ${r.id} должен отстоять от края габарита хотя бы на клетку`);
      }
    }
    if ((r.objects?.length ?? 0) > 2) problems.push(`В комнате ${r.id} больше двух объектов`);
  }

  const index = new Map(layout.rooms.map((r, i) => [r.id, i]));
  const edges: [number, number][] = [];
  layout.corridors.forEach((c) => {
    const a = rooms.get(c.a);
    const b = rooms.get(c.b);
    if (!a || !b) {
      problems.push(`Проход ${c.a}–${c.b}: нет такой комнаты`);
      return;
    }
    try {
      corridorGeometry(a, b, c);
    } catch (e) {
      problems.push((e as Error).message);
    }
    edges.push([index.get(c.a)!, index.get(c.b)!]);
  });

  const degree = new Array<number>(layout.rooms.length).fill(0);
  for (const [a, b] of edges) {
    degree[a]++;
    degree[b]++;
  }
  layout.rooms.forEach((r, i) => {
    if (degree[i] < 2) problems.push(`У комнаты ${r.id} ${degree[i]} проход(ов), нужно минимум 2`);
  });
  if (!isConnected(layout.rooms.length, edges)) problems.push('Граф комнат несвязен');
  for (const e of findBridges(layout.rooms.length, edges)) {
    const c = layout.corridors[e];
    problems.push(`Проход ${c.a}–${c.b} — мост: без него карта распадается`);
  }
  return problems;
};
