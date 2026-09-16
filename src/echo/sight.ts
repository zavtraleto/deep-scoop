import type { Vec2 } from '../math/vec2';
import type { EchoParams, EchoRing } from './echoPulse';
import { isVisible, lightStrength, type LightParams, type VisibilityPolygon } from './light';

/** С какой яркости свет «показывает» точку. */
const LIT_THRESHOLD = 0.3;

/** Что сейчас видит игрок: свет (многоугольник + форма) и свечение эха. */
export interface Sight {
  light: VisibilityPolygon;
  heading: number;
  lightParams: LightParams;
  rings: readonly EchoRing[];
  echo: EchoParams;
}

export const pointLit = (p: Vec2, s: Sight): boolean =>
  lightStrength(p.x - s.light.origin.x, p.y - s.light.origin.y, s.heading, s.lightParams) >= LIT_THRESHOLD &&
  isVisible(s.light, p);

/** Точку уже накрыл фронт эха, свечение за ним ещё не погасло, и точку видно из места импульса. */
export const pointEchoed = (p: Vec2, s: Sight): boolean =>
  s.rings.some((r) => {
    const d = Math.hypot(p.x - r.origin.x, p.y - r.origin.y);
    if (d > r.radius) return false;
    if (r.age - d / s.echo.speed > s.echo.glow) return false;
    return isVisible(r.poly, p);
  });

export const pointSeen = (p: Vec2, s: Sight): boolean => pointLit(p, s) || pointEchoed(p, s);

/** Объект виден, если видна его опора или точка на полпути к краю. */
export const areaSeen = (center: Vec2, radius: number, s: Sight): boolean => {
  const r = radius * 0.5;
  for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    if (pointSeen({ x: center.x + dx, y: center.y + dy }, s)) return true;
  }
  return false;
};

/**
 * Слепок памяти: где игрок видел вещь в последний раз. Видна вещь — слепок переезжает к ней.
 * Видно место слепка, а вещи там нет — слепок стирается (память обновилась).
 */
export interface Recollection {
  pos: Vec2;
  angle: number;
  known: boolean;
}

export const createRecollection = (): Recollection => ({ pos: { x: 0, y: 0 }, angle: 0, known: false });

export const updateRecollection = (
  rec: Recollection,
  thing: { pos: Vec2; angle: number; radius: number; exists: boolean },
  s: Sight,
): void => {
  if (thing.exists && areaSeen(thing.pos, thing.radius, s)) {
    rec.pos.x = thing.pos.x;
    rec.pos.y = thing.pos.y;
    rec.angle = thing.angle;
    rec.known = true;
    return;
  }
  if (rec.known && pointSeen(rec.pos, s)) rec.known = false;
};
