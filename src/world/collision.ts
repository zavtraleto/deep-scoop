import { closestPointOnSegment, type Segment, type Vec2 } from '../math/vec2';
import type { WallIndex } from './grid';

const scratch: Segment[] = [];

/**
 * Выталкивает круг из стен и гасит компонент скорости, направленный в стену, —
 * игрок скользит вдоль стены. Меняет pos и vel на месте. Возвращает true, если было касание.
 * restitution > 0 — мягкий отскок (доля нормальной скорости, которая отражается).
 */
export const resolveCircleVsWalls = (
  pos: Vec2,
  vel: Vec2,
  radius: number,
  walls: WallIndex,
  restitution = 0,
): boolean => {
  let touched = false;
  const segments = walls.near(pos.x, pos.y, radius, scratch);
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of segments) {
      const q = closestPointOnSegment(s, pos.x, pos.y);
      const dx = pos.x - q.x;
      const dy = pos.y - q.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 >= radius * radius) continue;
      const dist = Math.sqrt(dist2);
      let nx: number;
      let ny: number;
      if (dist > 1e-6) {
        nx = dx / dist;
        ny = dy / dist;
      } else {
        // Центр ровно на отрезке — выталкиваем по нормали отрезка.
        const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
        nx = -(s.by - s.ay) / len;
        ny = (s.bx - s.ax) / len;
      }
      const push = radius - dist;
      pos.x += nx * push;
      pos.y += ny * push;
      const vn = vel.x * nx + vel.y * ny;
      if (vn < 0) {
        vel.x -= nx * vn * (1 + restitution);
        vel.y -= ny * vn * (1 + restitution);
      }
      moved = true;
      touched = true;
    }
    if (!moved) break;
  }
  return touched;
};
