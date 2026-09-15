import GUI from 'lil-gui';
import { cameraConfig, cargoConfig, debugConfig, movementConfig, stickConfig } from '../core/config';

// Меняй версию, когда меняется набор параметров движения: старые сохранения несовместимы.
const STORAGE_KEY = 'memory-dive:tuning:v3';
const groups = {
  movement: movementConfig,
  cargo: cargoConfig,
  stick: stickConfig,
  camera: cameraConfig,
  debug: debugConfig,
};
const defaults = structuredClone(groups);

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<typeof groups> | null;
    if (!saved) return;
    for (const key of Object.keys(groups) as (keyof typeof groups)[]) Object.assign(groups[key], saved[key]);
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
}

/** Панель тюнинга: параметры сохраняются в localStorage, кнопка копирует их JSON для переноса в config.ts. */
export const createTuningPanel = (stats: TuningStats): GUI => {
  load();
  const gui = new GUI({ title: 'Тюнинг (G — скрыть)' });
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

  const c = gui.addFolder('Груз (тест массы)');
  c.add(cargoConfig, 'cargo', 0, 30, 0.1).name('cargo').listen();
  c.add(cargoConfig, 'cargoMax', 1, 30, 1).name('cargoMax');

  const s = gui.addFolder('Стик');
  s.add(stickConfig, 'radius', 30, 200, 1).name('радиус, px');
  s.add(stickConfig, 'deadZone', 0, 0.5, 0.01).name('мёртвая зона');
  s.add(stickConfig, 'followFinger').name('центр за пальцем');

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
      for (const key of Object.keys(groups) as (keyof typeof groups)[]) Object.assign(groups[key], defaults[key]);
      gui.controllersRecursive().forEach((ctrl) => ctrl.updateDisplay());
      save();
    },
  };
  gui.add(actions, 'copy').name('📋 Скопировать параметры');
  gui.add(actions, 'reset').name('↺ Сбросить к GDD');

  gui.onChange(save);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') gui.show(gui._hidden);
  });
  return gui;
};
