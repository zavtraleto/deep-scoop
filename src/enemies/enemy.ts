import type { Vec2 } from '../math/vec2';

/** Типы врагов. Различаются только выбором цели (спецификация пользователя). */
export type EnemyKind = 'hunter';

/** Откуда враг узнал о игроке. */
export type InfoSource = 'pulse' | 'noise' | 'sight';

/** Что враг знает об игроке: только то, что пришло событием обнаружения. */
export interface PlayerInfo {
  /** Позиция игрока в момент обнаружения. */
  pos: Vec2;
  /** Направление движения (единичный вектор) или null, если игрок почти стоял. */
  dir: Vec2 | null;
  /** Расстояние от врага до игрока в момент обнаружения, ед. */
  distance: number;
  /** Время обнаружения, с симуляции. */
  time: number;
  source: InfoSource;
}

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  /** Точка появления — «свой зал». */
  readonly home: Vec2;
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  /** Куда смотрит тело, рад. */
  heading: number;
  prevHeading: number;
  /** Последнее известное о игроке (lastKnownPlayerPosition и сопутствующее). */
  info: PlayerInfo | null;
  /** Текущая цель движения (мир). null — стоит. */
  target: Vec2 | null;
  /** Путевые точки к цели. */
  path: Vec2[];
  /** До пересчёта пути, с. */
  repath: number;
  /** Цель достигнута: ждёт новой информации. */
  arrived: boolean;
  /** Враг прямо сейчас видит игрока. */
  sees: boolean;
  /** Вспышка «заметил» (1 → 0) — после нового обнаружения. */
  alert: number;
}

let nextId = 1;

export const createEnemy = (kind: EnemyKind, pos: Vec2): Enemy => ({
  id: nextId++,
  kind,
  home: { ...pos },
  pos: { ...pos },
  prevPos: { ...pos },
  vel: { x: 0, y: 0 },
  heading: -Math.PI / 2,
  prevHeading: -Math.PI / 2,
  info: null,
  target: null,
  path: [],
  repath: 0,
  arrived: false,
  sees: false,
  alert: 0,
});

export const resetEnemy = (e: Enemy): void => {
  Object.assign(e.pos, e.home);
  Object.assign(e.prevPos, e.home);
  e.vel.x = e.vel.y = 0;
  e.heading = e.prevHeading = -Math.PI / 2;
  e.info = null;
  e.target = null;
  e.path.length = 0;
  e.repath = 0;
  e.arrived = false;
  e.sees = false;
  e.alert = 0;
};

/**
 * Выбор цели по типу врага: calculateTarget(enemy, playerInfo) → точка мира.
 * Недостижимую цель общий код заменяет ближайшей доступной клеткой.
 */
export type TargetFn = (enemy: Enemy, info: PlayerInfo) => Vec2;

export const targetFns: Record<EnemyKind, TargetFn> = {
  /** Hunter: прямое преследование — к последней известной позиции игрока. */
  hunter: (_e, info) => info.pos,
};
