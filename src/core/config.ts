// Стартовые параметры (Приложение A GDD). Объект мутабельный — его правит панель тюнинга.

import type { MovementParams } from '../player/movement';

export const CELL = 2; // размер клетки, ед.
export const PLAYER_RADIUS = 0.5; // диаметр игрока 1 ед.

export const movementConfig: MovementParams = {
  maxSpeed: 6, // ед./с
  accelTime: 0.4, // с, разгон до максимума без груза
  stopTime: 0.8, // с, торможение до остановки с максимальной скорости
  /** Доля «вязкой» (пропорциональной скорости) части drag. 0 — равномерное торможение, ближе к 1 — длинный плавный хвост. */
  dragViscousShare: 0.6,
  /** true — сила стика ограничивает скорость (полстика = полскорости); false — сила влияет только на ускорение. */
  analogSpeedCap: true,
  baseMass: 1,
  // Поворот и занос «заднеприводной машины». Подобрано симуляцией (см. movement.test.ts):
  // 180° на полной скорости — тормоз, пронос ~0.7 ед.; 90° на полной — занос, пронос ~2 ед.; на малой — точно.
  steerRate: 7, // рад/с, доворот носа на полной скорости
  steerLowSpeedBoost: 2, // на месте доворот в 1 + 2 = 3 раза быстрее
  thrustAlignmentPower: 1, // тяга × cos(нос→стик)^power
  rearSectorDeg: 90, // задняя четверть стика — тормоз
  brakeTime: 0.35, // с, с максимума до нуля без груза
  brakeMinSpeed: 1, // ед./с, ниже — разворот на месте
  grip: 3, // сцепление вбок
  driftGrip: 0.3, // сцепление в полном заносе, доля от grip
  driftSpeedStart: 0.55, // доля maxSpeed, с которой начинается занос
  driftTurnStartDeg: 35, // резкость поворота, с которой начинается срыв (полный — на 90°)
  driftOverrotateDeg: 20, // перекрут носа внутрь поворота в заносе
  coastAlignRate: 3, // 1/с, нос к скорости без ввода
  cargoHandlingExponent: 1, // груз делит доворот и сцепление на massFactor^k
};

export const cargoConfig = {
  cargo: 0,
  cargoMax: 10,
};

export const stickConfig = {
  radius: 80, // px
  deadZone: 0.1, // доля радиуса
  /** true — центр стика подтягивается за пальцем, если тот ушёл дальше радиуса. */
  followFinger: false,
};

export const cameraConfig = {
  fov: 40, // градусы, по вертикали
  /** Видимый размер мира (ед.) по короткой стороне экрана. */
  viewSize: 24,
  followRate: 5, // 1/с, скорость догоняния цели
  leadTime: 0.35, // с, опережение = скорость * leadTime
  leadVerticalScale: 1.6, // опережение по вертикали больше
  leadRate: 3, // 1/с, сглаживание самого опережения
};

export const debugConfig = {
  /** Круг зон стика вокруг игрока: зона поворота, задний сектор-тормоз, ввод и скорость. */
  showStickZones: true,
};

export const physicsConfig = {
  step: 1 / 120,
  maxSubsteps: 12,
};
