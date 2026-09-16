import { describe, expect, it } from 'vitest';
import { collectConfig } from '../core/config';
import { Grid } from '../world/grid';
import { CollectWorld, type CollectWorldParams } from './collectWorld';
import type { Cargo } from './collector';
import { applyNudge, stepFloat } from './floatPhysics';
import { findComponents, fracture } from './fracture';
import { createScoopState } from './scoop';
import { seededRng, solidObject, testScoop } from './testHelpers';

const params: CollectWorldParams = { ...collectConfig, scoop: testScoop };
const dt = 1 / 120;
const cut = { point: { x: 0, y: 0 }, dir: { x: 0, y: 1 }, playerVel: { x: 0, y: 6 } };

/** Стереть вертикальную полосу через весь объект по центру: x ∈ [−halfWidth, halfWidth]. */
const cutVertical = (obj: ReturnType<typeof solidObject>, halfWidth = 0.6, x = 0) =>
  obj.erase([
    { x: x - halfWidth, y: -20 },
    { x: x + halfWidth, y: -20 },
    { x: x + halfWidth, y: 20 },
    { x: x - halfWidth, y: 20 },
  ]);

describe('раскол', () => {
  it('ищет связные области по 4-соседству', () => {
    const obj = solidObject(4, 2);
    cutVertical(obj, 0.2);
    expect(findComponents(obj.mask).components).toHaveLength(2);
  });

  it('полоса насквозь делит объект на два куска, ценность сохраняется', () => {
    const obj = solidObject(7, 6, 6);
    const erased = cutVertical(obj);
    const r = fracture(obj, cut, collectConfig.fracture, seededRng());
    expect(r.pieces).toHaveLength(2);
    const pieces = r.pieces!;
    const erasedValue = (erased / obj.root.totalOpaque) * 6;
    const piecesValue = pieces.reduce((s, p) => s + p.value, 0);
    expect(piecesValue + erasedValue).toBeCloseTo(6, 6);
  });

  it('куски лежат ровно там, где были в объекте, и расходятся в стороны от разреза', () => {
    const obj = solidObject(7, 6);
    cutVertical(obj);
    const [a, b] = fracture(obj, cut, collectConfig.fracture, seededRng()).pieces!;
    const left = a.body.pos.x < b.body.pos.x ? a : b;
    const right = left === a ? b : a;
    // Центр левой половины: x ≈ −(3.5 + 0.6) / 2.
    expect(left.body.pos.x).toBeCloseTo(-2.05, 1);
    expect(left.body.vel.x).toBeLessThan(0);
    expect(right.body.vel.x).toBeGreaterThan(0);
    // Пиксель куска отображается в ту же мировую точку, что и у родителя.
    const px = 5;
    const py = 7;
    const w = left.maskToWorld(px, py);
    const pw = obj.maskToWorld(px + left.offsetX, py + left.offsetY);
    expect(w.x).toBeCloseTo(pw.x, 6);
    expect(w.y).toBeCloseTo(pw.y, 6);
  });

  it('выемка без прохода насквозь не раскалывает', () => {
    const obj = solidObject(7, 6);
    obj.erase([
      { x: -0.6, y: -10 },
      { x: 0.6, y: -10 },
      { x: 0.6, y: 1 },
      { x: -0.6, y: 1 },
    ]);
    expect(fracture(obj, cut, collectConfig.fracture, seededRng()).pieces).toBeNull();
  });

  it('крошка рассыпается в груз, объект остаётся целым', () => {
    const obj = solidObject(7, 6);
    cutVertical(obj, 0.275, 3.175); // у правого края остаётся полоска 0.05 × 6 = 0.3 ед.² < порога
    const r = fracture(obj, cut, collectConfig.fracture, seededRng());
    expect(r.pieces).toBeNull();
    expect(r.crumbPixels).toBeGreaterThan(0);
    expect(r.crumbSamples.length).toBeGreaterThan(0);
    expect(findComponents(obj.mask).components).toHaveLength(1);
  });

  it('полностью стёртый объект исчезает', () => {
    const obj = solidObject(2, 2);
    cutVertical(obj, 5);
    expect(fracture(obj, cut, collectConfig.fracture, seededRng()).pieces).toEqual([]);
  });

  it('стирание учитывает поворот объекта', () => {
    const obj = solidObject(4, 2);
    obj.body.angle = Math.PI / 2; // теперь объект вытянут вертикально
    // Горизонтальная полоса в мире — это вертикальная полоса в маске: режет объект пополам.
    obj.erase([
      { x: -5, y: -0.2 },
      { x: 5, y: -0.2 },
      { x: 5, y: 0.2 },
      { x: -5, y: 0.2 },
    ]);
    expect(findComponents(obj.mask).components).toHaveLength(2);
  });
});

describe('парение', () => {
  it('целый объект дрейфует рядом с домом и стартует без рывка', () => {
    const obj = solidObject(2, 2);
    for (let t = 0; t < 0.5; t += dt) stepFloat([obj], null, collectConfig.float, dt);
    expect(Math.hypot(obj.body.pos.x, obj.body.pos.y)).toBeLessThan(0.1);
    let maxDist = 0;
    for (let t = 0; t < 30; t += dt) {
      stepFloat([obj], null, collectConfig.float, dt);
      const { pos, home } = obj.body;
      maxDist = Math.max(maxDist, Math.hypot(pos.x - home.x, pos.y - home.y));
    }
    expect(maxDist).toBeGreaterThan(0.2); // действительно плавает
    expect(maxDist).toBeLessThan(collectConfig.float.hoverRadius * 1.6);
    expect(Math.abs(obj.body.angle)).toBeLessThan((6 * Math.PI) / 180);
  });

  it('разлетевшийся кусок медленно отплывает, оседает и парит на новом месте', () => {
    const obj = solidObject(7, 6);
    cutVertical(obj);
    const pieces = fracture(obj, cut, collectConfig.fracture, seededRng()).pieces!;
    const start = pieces.map((p) => ({ ...p.body.pos }));
    let maxSpeed = 0;
    for (let t = 0; t < 8; t += dt) {
      stepFloat(pieces, null, collectConfig.float, dt);
      for (const p of pieces) maxSpeed = Math.max(maxSpeed, Math.hypot(p.body.vel.x, p.body.vel.y));
    }
    expect(maxSpeed).toBeLessThan(2); // медленно
    for (let i = 0; i < pieces.length; i++) {
      const moved = Math.abs(pieces[i].body.pos.x - start[i].x);
      expect(moved).toBeGreaterThan(0.4);
      expect(pieces[i].body.drifting).toBe(false);
      expect(Math.abs(pieces[i].body.angle)).toBeLessThan((15 * Math.PI) / 180); // вращение едва заметно
    }
  });

  it('стены удерживают объект внутри комнаты', () => {
    const g = new Grid(6, 6);
    g.carveRect(1, 1, 4, 4); // комната 8×8 ед.
    const walls = g.buildWalls();
    const obj = solidObject(2, 2, 1, { x: 5, y: -5 });
    obj.body.vel.x = 20;
    obj.body.drifting = true;
    for (let t = 0; t < 3; t += dt) stepFloat([obj], walls, collectConfig.float, dt);
    expect(obj.body.pos.x).toBeLessThan(10);
  });

  it('толчок ковша: лёгкое сдвигается заметнее тяжёлого', () => {
    const light = solidObject(1, 1);
    const heavy = solidObject(7, 6);
    const vel = { x: 6, y: 0 };
    applyNudge(light, { x: 0, y: 0 }, vel, 0.05, collectConfig.float);
    applyNudge(heavy, { x: 0, y: 0 }, vel, 0.05, collectConfig.float);
    expect(light.body.vel.x).toBeGreaterThan(heavy.body.vel.x * 5);
    expect(light.body.vel.x).toBeLessThanOrEqual(6 * collectConfig.float.nudgeMaxSpeedFrac + 1e-9);
  });
});

describe('мир объектов', () => {
  it('пролёт насквозь раскалывает объект, куски приходят событиями, груз копится', () => {
    const world = new CollectWorld(seededRng());
    world.add(solidObject(4, 3, 6));
    world.events.length = 0;
    const scoop = createScoopState(-Math.PI / 2);
    const cargo: Cargo = { cargo: 0, cargoMax: 100 };
    const player = { pos: { x: 0, y: 5 }, vel: { x: 0, y: -6 }, heading: -Math.PI / 2 };
    for (let t = 0; t < 2; t += dt) {
      player.pos.y += player.vel.y * dt;
      world.step(player, scoop, cargo, null, params, dt);
    }
    expect(world.objects.length).toBe(2);
    expect(world.events.filter((e) => e.type === 'added' && e.bySplit)).toHaveLength(2);
    expect(world.events.filter((e) => e.type === 'removed')).toHaveLength(1);
    expect(cargo.cargo).toBeGreaterThan(0);
    const remaining = world.objects.reduce((s, o) => s + o.value, 0);
    expect(remaining + cargo.cargo).toBeCloseTo(6, 1);
    for (let t = 0; t < 6; t += dt) world.step(player, scoop, cargo, null, params, dt);
    for (const o of world.objects) expect(Math.abs(o.body.angle)).toBeLessThan((5 * Math.PI) / 180);
  });
});
