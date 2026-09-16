// Стартовые параметры (Приложение A GDD). Объект мутабельный — его правит панель тюнинга.

import type { FloatParams } from '../collect/floatPhysics';
import type { FractureParams } from '../collect/fracture';
import type { ObjectClass, ObjectClassDef } from '../collect/memoryObject';
import type { EchoParams } from '../echo/echoPulse';
import type { EnemyParams } from '../enemies/enemySystem';
import type { LightLook, LightParams } from '../echo/light';
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

/** Видимость (§9, решения этапа 3): свет игрока, эхо, туман. */
export const visionConfig = {
  light: {
    radius: 2 * CELL, // ед., круг света — 2 клетки
    coneRange: 4 * CELL, // ед., луч вперёд по носу — 4 клетки
    coneAngleDeg: 60,
    softness: 0.35, // мягкий край света
  } satisfies LightParams,
  /** Вид света: тёплый подводный; ореол вокруг существа тусклее луча-прожектора (решение пользователя). */
  look: {
    ambientLevel: 0.5, // ореол рассеивает туман наполовину
    beamLevel: 1, // прожектор — полностью
    color: '#ffc861',
    ambientTint: 0.05,
    beamTint: 0.14,
  } satisfies LightLook,
  echo: {
    interval: 4, // с
    radius: 100, // ед. (50 клеток) — решение пользователя, в Приложении A было 8 клеток
    speed: 20 * CELL, // ед./с, 20 клеток/с
    glow: 1.5, // с, свечение Echo-клеток
    // Решение пользователя: эхо не проходит сквозь стены (в отличие от §16).
  } satisfies EchoParams,
  /** Как часто свет отмечает клетки увиденными, Гц. */
  exploreRate: 20,
  fog: {
    unknownDarkness: 1, // Unknown — полная темнота
    // Explored вне света и эха — «мутная память» (решение пользователя).
    memoryBrightness: 0.55, // яркость памяти
    memorySaturation: 0.3, // насыщенность памяти (0 — серая)
    memoryBlur: 2.5, // сила размытия, px половинного разрешения
    memoryWarp: 0.004, // сила «плывения», доля экрана
  },
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

/**
 * Враги (этап 4, спецификация пользователя): позицию игрока узнают только из событий —
 * пульс (сквозь стены), шум сбора, прямая видимость вблизи.
 */
export const enemyConfig: EnemyParams = {
  radius: 0.7, // ед., чуть крупнее игрока (решение пользователя)
  accelTime: 0.6, // с, «существо с инерцией»
  turnRate: 5, // рад/с
  arriveRadius: 0.8, // ед.
  slowRadius: 3, // ед.
  repathInterval: 0.25, // с, §10.1
  lookahead: 5, // путевых точек
  pulseHearRadius: 100, // ед., = радиус эха; слышно сквозь стены (решение пользователя)
  sightRadius: 10, // ед. (5 клеток), прямая видимость
  sightInterval: 0.1, // с
  noiseRadius: 20, // ед. (10 клеток, §10.4)
  noiseInterval: 0.5, // с
  noiseSpeedBonus: 0.25, // §10.3
  cargoThreshold: 0.5, // §11
  cargoDetectScale: 1.5, // радиусы обнаружения ×1.5 с грузом ≥ 50%
  moveDirMinSpeed: 0.5, // ед./с
  alertTime: 0.8, // с
  kinds: {
    hunter: { speed: 4.8 }, // ед./с, 80% скорости игрока (§10.6, Chaser)
  },
};

export const enemyLook = {
  /** Маркер последней позиции врага после пульса гаснет за это время, с (§9.3). */
  markerTime: 3,
  /** Смерть: анимация до сброса уровня, с (§13: до 1 с). */
  deathTime: 0.8,
};

/**
 * Карта (решения пользователя): во весь экран поверх игры, «двойная экспозиция»; открывается
 * развёрткой — вторым фронтом импульса эха, дальше и сквозь стены. Точки — как локатор из «Чужого».
 */
export const mapConfig = {
  show: true,
  scale: 5, // во сколько раз больше мира, чем игровой экран
  radius: 200, // ед., радиус развёртки (сквозь стены, только точки)
  lineWidth: 1.2, // px, толщина контуров
  opacity: 0.4, // яркость контуров у краёв
  centerOpacity: 0.12, // доля яркости у персонажа
  clearRadius: 0.06, // доля короткой стороны экрана: у персонажа карта прозрачнее всего
  fullRadius: 0.45, // доля короткой стороны: отсюда карта в полную силу
  flashTime: 0.6, // с, вспышка открытого контура и засечённой точки
  blipSize: 18, // px
  itemColor: '#5dff8a',
  enemyColor: '#ff4a5a',
  enemyLife: 4, // с, точка врага гаснет (≈ до следующего импульса)
};

export const debugConfig = {
  /** Вся отладка (панель тюнинга и отладочные элементы в сцене). Переключается клавишей G. */
  visible: true,
  /** Круг зон стика вокруг игрока: зона поворота, задний сектор-тормоз, ввод и скорость. */
  showStickZones: true,
  /** Раскладка чанка: границы слотов и граф проходов. */
  showLayout: false,
  /** Туман войны. Выключение — чтобы смотреть карту целиком. */
  fog: true,
  /** Враги видны всегда, с путём, целью и последней известной позицией игрока. */
  showEnemies: false,
  /** Касание врага не убивает. */
  immortal: false,
};

export const physicsConfig = {
  step: 1 / 120,
  maxSubsteps: 12,
};
