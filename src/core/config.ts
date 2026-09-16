// Стартовые параметры (Приложение A GDD). Объект мутабельный — его правит панель тюнинга.

import type { FloatParams } from '../collect/floatPhysics';
import type { FractureParams } from '../collect/fracture';
import type { ObjectClass, ObjectClassDef } from '../collect/memoryObject';
import type { ScoopParams } from '../collect/scoop';
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
  // 180° на полной скорости — тормоз, тяжёлый разворот, назад на 90% скорости за ~0.9 с, пронос ~1 ед.;
  // 90° на полной — занос, пронос ~2.3 ед.; на малой — точно.
  steerRate: 7, // рад/с, доворот носа на полной скорости
  steerLowSpeedBoost: 1, // на месте доворот до 1 + 1 = 2 раз быстрее
  steerSpinUpTime: 0.15, // с, раскрутка носа до steerRate — инерция вращения, «вес»
  steerSettleTime: 0.1, // с, мягкость подхода носа к цели
  thrustAlignmentPower: 1, // тяга × cos(нос→стик)^power
  rearSectorDeg: 90, // задняя четверть стика — тормоз
  brakeTime: 0.45, // с, с максимума до нуля без груза
  brakeMinSpeed: 1.2, // ед./с, ниже — разворот на месте (ещё скользя вперёд)
  grip: 3.5, // сцепление вбок
  driftGrip: 0.3, // сцепление в полном заносе, доля от grip
  driftSpeedStart: 0.55, // доля maxSpeed, с которой начинается занос
  driftTurnStartDeg: 35, // резкость поворота, с которой начинается срыв (полный — на 90°)
  driftOverrotateDeg: 20, // перекрут носа внутрь поворота в заносе
  coastAlignRate: 3, // 1/с, нос к скорости без ввода
  cargoHandlingExponent: 1, // груз делит доворот и сцепление на massFactor^k
};

export const cargoConfig = {
  cargoMax: 10, // стартовый лимит груза (§11)
};

export const collectConfig = {
  scoop: {
    width: 1.2, // ед., поперёк движения (Приложение A)
    depth: 0.6, // ед., вдоль движения (Приложение A)
    offset: 0.3, // ед., от центра игрока до заднего края ковша
    followNose: false, // решение этапа 2: ковш по скорости — полоса всегда во всю ширину, занос = инструмент
    noseBlendSpeed: 1.2, // ед./с, ниже — ковш плавно переходит на нос
    turnRate: 18, // 1/с, сглаживание поворота ковша
  } satisfies ScoopParams,
  /** §7: размер большей стороны в диаметрах игрока и базовая ценность. */
  classes: {
    small: { size: 2, value: 1 },
    medium: { size: 4, value: 3 },
    large: { size: 7, value: 6 },
  } satisfies Record<ObjectClass, ObjectClassDef>,
  /** Парение и физика объектов (решения этапа 3 с пользователем: вязкая «подводная» среда). */
  float: {
    linearDrag: 1.0, // 1/с
    angularDrag: 1.6, // 1/с
    hoverRadius: 0.8, // ед., дрейф вокруг дома
    hoverSpeed: 0.35, // рад/с, темп дрейфа
    hoverSpring: 0.8, // 1/с², тяга к точке дрейфа
    hoverWobbleDeg: 3, // покачивание ±3°
    wobbleSpring: 1.5, // 1/с²
    settleSpeed: 0.12, // ед./с, разлетевшийся кусок оседает и заводит новый дом
    wallRestitution: 0.3, // мягкий отскок от стен
    collisionRadiusScale: 0.85, // круг столкновений от круга равной площади
    separation: 6, // 1/с², мягкое расталкивание кусков
    nudge: 0.35, // толчок ковша
    nudgeMaxSpeedFrac: 0.35, // толчок не разгоняет быстрее доли скорости игрока
    nudgeTorque: 0.06, // доля толчка во вращение — вращение должно быть едва заметным
  } satisfies FloatParams,
  /** Раскол по реальному разрезу. */
  fracture: {
    minPieceArea: 0.5, // ед.², меньше — крошка, рассыпается в груз
    splitSpeed: 1.0, // ед./с, разлёт куска эталонной площади — медленно, «разрезанный под водой плод»
    splitRefArea: 4, // ед.²
    splitInherit: 0.12, // доля скорости игрока
    splitSpin: 0.12, // рад/с — вращение едва заметно
    burstPerPiece: 10, // частиц вспышки вдоль разреза
  } satisfies FractureParams,
  fractureCheckInterval: 0.1, // с
  /** Разрешение маски: 64 px на small (2 ед.) → 32 px/ед., крупные пропорционально (§6.3). */
  maskPixelsPerUnit: 32,
  /** Сколько стёртых пикселей за шаг физики превращать в частицы. */
  particlesPerStep: 6,
};

export const stickConfig = {
  radius: 80, // px
  deadZone: 0.1, // доля радиуса
  /** true — центр стика подтягивается за пальцем, если тот ушёл дальше радиуса. */
  followFinger: false,
};

/** Управление мышью: держи ЛКМ — персонаж плывёт к курсору (решение пользователя). */
export const mouseConfig = {
  deadZone: 0.6, // ед., вокруг персонажа ввод нулевой
  fullDistance: 5, // ед. (~2.5 клетки), дальше — полная сила
  /** Старый режим для сравнения: мышь работает как виртуальный стик. */
  asStick: false,
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
  /** Вся отладка (панель тюнинга и отладочные элементы в сцене). Переключается клавишей G. */
  visible: true,
  /** Круг зон стика вокруг игрока: зона поворота, задний сектор-тормоз, ввод и скорость. */
  showStickZones: true,
};

export const physicsConfig = {
  step: 1 / 120,
  maxSubsteps: 12,
};
