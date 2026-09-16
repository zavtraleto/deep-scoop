import GUI from 'lil-gui';
import {
  cameraConfig,
  cargoConfig,
  collectConfig,
  debugConfig,
  mouseConfig,
  movementConfig,
  stickConfig,
} from '../core/config';

// Меняй версию, когда смысл или значения по умолчанию параметров меняются так, что старые сохранения вредны.
// Новые поля добавлять можно без смены версии: mergeInto переносит только известные поля.
const STORAGE_KEY = 'memory-dive:tuning:v4';
const groups = {
  movement: movementConfig,
  cargo: cargoConfig,
  collect: collectConfig,
  stick: stickConfig,
  mouse: mouseConfig,
  camera: cameraConfig,
  debug: debugConfig,
};
const defaults = structuredClone(groups);

/**
 * Рекурсивно переписать в dst значения известных ему полей из src. Объекты dst не подменяются:
 * на них держатся контроллеры панели и ссылки из игрового кода (collectConfig.scoop).
 */
const mergeInto = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(src)) {
    if (!(k in dst)) continue;
    const d = dst[k];
    if (v && typeof v === 'object' && d && typeof d === 'object') {
      mergeInto(d as Record<string, unknown>, v as Record<string, unknown>);
    } else if (typeof v === typeof d) {
      dst[k] = v;
    }
  }
};

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
    if (saved) mergeInto(groups, saved);
  } catch {
    // Повреждённое или недоступное хранилище — остаёмся на значениях по умолчанию.
  }
};

const save = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Хранилище недоступно (приватный режим) — тюнинг просто не переживёт перезагрузку.
  }
};

export interface TuningStats {
  speed: number;
  input: number;
  mass: number;
  drift: number;
  /** §6.4: ковш стирает на этом шаге. */
  noise: boolean;
  /** Прогресс извлечения объектов уровня, %. */
  progress: number;
  /** Сколько сейчас объектов и кусков. */
  pieces: number;
}

/** Состояние забега, которое удобно крутить руками. В localStorage не сохраняется. */
export interface TuningRun {
  cargo: number;
  resetObjects: () => void;
}

/** Панель тюнинга: параметры сохраняются в localStorage, кнопка копирует их JSON для переноса в config.ts. */
export const createTuningPanel = (stats: TuningStats, run: TuningRun): GUI => {
  load();
  const gui = new GUI({ title: 'Тюнинг (G — скрыть отладку)' });
  if (matchMedia('(pointer: coarse)').matches) gui.close();

  const live = gui.addFolder('Показатели');
  live.add(stats, 'speed').name('скорость, ед./с').decimals(2).listen().disable();
  live.add(stats, 'input').name('сила ввода').decimals(2).listen().disable();
  live.add(stats, 'mass').name('масса').decimals(2).listen().disable();

  const m = gui.addFolder('Движение');
  m.add(movementConfig, 'maxSpeed', 1, 15, 0.1).name('макс. скорость');
  m.add(movementConfig, 'accelTime', 0.05, 2, 0.01).name('разгон, с');
  m.add(movementConfig, 'stopTime', 0.05, 3, 0.01).name('торможение, с');
  m.add(movementConfig, 'dragViscousShare', 0, 0.95, 0.01).name('плавность хвоста');
  m.add(movementConfig, 'analogSpeedCap').name('сила стика = лимит');

  const t = gui.addFolder('Поворот и тормоз');
  t.add(movementConfig, 'steerRate', 1, 30, 0.1).name('доворот носа, рад/с');
  t.add(movementConfig, 'steerLowSpeedBoost', 0, 6, 0.1).name('доворот на месте ×');
  t.add(movementConfig, 'steerSpinUpTime', 0.001, 1, 0.005).name('инерция вращения, с');
  t.add(movementConfig, 'steerSettleTime', 0.001, 0.5, 0.005).name('мягкость доворота, с');
  t.add(movementConfig, 'thrustAlignmentPower', 0, 4, 0.05).name('тяга только по носу');
  t.add(movementConfig, 'rearSectorDeg', 0, 180, 1).name('задний сектор, °');
  t.add(movementConfig, 'brakeTime', 0.05, 2, 0.01).name('тормоз, с');
  t.add(movementConfig, 'brakeMinSpeed', 0, 6, 0.1).name('тормоз от скорости');

  const d = gui.addFolder('Занос');
  d.add(movementConfig, 'grip', 0, 8, 0.05).name('сцепление');
  d.add(movementConfig, 'driftGrip', 0, 1, 0.01).name('сцепление в заносе');
  d.add(movementConfig, 'driftSpeedStart', 0, 1, 0.01).name('занос от скорости (доля)');
  d.add(movementConfig, 'driftTurnStartDeg', 0, 89, 1).name('занос от угла, °');
  d.add(movementConfig, 'driftOverrotateDeg', 0, 60, 1).name('перекрут носа, °');
  d.add(movementConfig, 'coastAlignRate', 0, 15, 0.1).name('нос к скорости (без ввода)');
  d.add(movementConfig, 'cargoHandlingExponent', 0, 2, 0.05).name('влияние груза');

  live.add(stats, 'drift').name('занос').decimals(2).listen().disable();

  gui.add(debugConfig, 'showStickZones').name('👁 зоны стика у игрока');

  live.add(stats, 'noise').name('шум (стирает)').listen().disable();
  live.add(stats, 'progress').name('извлечено, %').decimals(1).listen().disable();
  live.add(stats, 'pieces').name('объектов и кусков').listen().disable();

  const c = gui.addFolder('Ковш и груз');
  c.add(run, 'cargo', 0, 30, 0.1).name('cargo').listen();
  c.add(cargoConfig, 'cargoMax', 1, 30, 1).name('cargoMax');
  const scoop = collectConfig.scoop;
  c.add(scoop, 'width', 0.2, 4, 0.05).name('ширина ковша');
  c.add(scoop, 'depth', 0.1, 2, 0.05).name('глубина ковша');
  c.add(scoop, 'offset', -0.5, 1.5, 0.05).name('отступ от центра');
  c.add(scoop, 'followNose').name('ковш по носу (а не по скорости)');
  c.add(scoop, 'noseBlendSpeed', 0.1, 4, 0.05).name('на нос ниже скорости');
  c.add(scoop, 'turnRate', 1, 60, 0.5).name('сглаживание поворота');
  c.add(collectConfig, 'particlesPerStep', 0, 30, 1).name('частиц за шаг');
  c.add(run, 'resetObjects').name('↺ Восстановить объекты и груз');

  const f = gui.addFolder('Парение и раскол');
  const fl = collectConfig.float;
  f.add(fl, 'linearDrag', 0, 5, 0.05).name('вязкость движения');
  f.add(fl, 'angularDrag', 0, 8, 0.05).name('вязкость вращения');
  f.add(fl, 'hoverRadius', 0, 3, 0.05).name('радиус дрейфа, ед.');
  f.add(fl, 'hoverSpeed', 0, 2, 0.01).name('темп дрейфа');
  f.add(fl, 'hoverSpring', 0, 5, 0.05).name('тяга к дому');
  f.add(fl, 'hoverWobbleDeg', 0, 20, 0.5).name('покачивание, °');
  f.add(fl, 'settleSpeed', 0.01, 1, 0.01).name('оседание ниже скорости');
  f.add(fl, 'wallRestitution', 0, 1, 0.05).name('отскок от стен');
  f.add(fl, 'collisionRadiusScale', 0.3, 1.5, 0.05).name('радиус столкновений ×');
  f.add(fl, 'separation', 0, 30, 0.5).name('расталкивание');
  f.add(fl, 'nudge', 0, 3, 0.05).name('толчок ковша');
  f.add(fl, 'nudgeMaxSpeedFrac', 0, 1, 0.01).name('толчок: макс. доля скорости');
  f.add(fl, 'nudgeTorque', 0, 2, 0.05).name('толчок во вращение');
  const fr = collectConfig.fracture;
  f.add(fr, 'minPieceArea', 0, 4, 0.05).name('крошка меньше, ед.²');
  f.add(fr, 'splitSpeed', 0, 5, 0.05).name('скорость разлёта');
  f.add(fr, 'splitInherit', 0, 1, 0.01).name('доля скорости игрока');
  f.add(fr, 'splitSpin', 0, 2, 0.01).name('вращение при расколе');
  f.add(fr, 'burstPerPiece', 0, 40, 1).name('искр вспышки на кусок');

  const s = gui.addFolder('Ввод');
  s.add(stickConfig, 'radius', 30, 200, 1).name('тач: радиус стика, px');
  s.add(stickConfig, 'deadZone', 0, 0.5, 0.01).name('тач: мёртвая зона');
  s.add(stickConfig, 'followFinger').name('тач: центр за пальцем');
  s.add(mouseConfig, 'deadZone', 0, 3, 0.05).name('мышь: мёртвая зона, ед.');
  s.add(mouseConfig, 'fullDistance', 0.5, 15, 0.1).name('мышь: полная сила, ед.');
  s.add(mouseConfig, 'asStick').name('мышь как стик (старый режим)');

  const cam = gui.addFolder('Камера');
  cam.add(cameraConfig, 'fov', 15, 90, 1).name('fov');
  cam.add(cameraConfig, 'viewSize', 8, 60, 0.5).name('обзор, ед.');
  cam.add(cameraConfig, 'followRate', 0.5, 20, 0.1).name('следование');
  cam.add(cameraConfig, 'leadTime', 0, 1.5, 0.01).name('опережение, с');
  cam.add(cameraConfig, 'leadVerticalScale', 0, 4, 0.05).name('опереж. по вертикали ×');
  cam.add(cameraConfig, 'leadRate', 0.2, 20, 0.1).name('сглаж. опережения');

  const actions = {
    copy: () => {
      const json = JSON.stringify(groups, null, 2);
      console.log(json);
      navigator.clipboard?.writeText(json).catch(() => undefined);
    },
    reset: () => {
      mergeInto(groups, defaults);
      gui.controllersRecursive().forEach((ctrl) => ctrl.updateDisplay());
      save();
    },
  };
  gui.add(actions, 'copy').name('📋 Скопировать параметры');
  gui.add(actions, 'reset').name('↺ Сбросить к GDD');

  gui.onChange(save);
  // G прячет и показывает всю отладку разом: панель и отладочные элементы в сцене.
  gui.show(debugConfig.visible);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG' || e.repeat) return;
    debugConfig.visible = !debugConfig.visible;
    gui.show(debugConfig.visible);
    save();
  });
  return gui;
};
