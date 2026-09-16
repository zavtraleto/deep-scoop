import { describe, expect, it } from 'vitest';
import { visionConfig } from '../core/config';
import { Grid } from '../world/grid';
import { echoVisibility, type EchoRing } from './echoPulse';
import { castVisibility } from './light';
import { createRecollection, pointEchoed, pointLit, updateRecollection, type Sight } from './sight';

const open = new Grid(30, 30, 0).buildWalls();

const sight = (origin = { x: 10, y: -10 }, rings: EchoRing[] = []): Sight => ({
  light: castVisibility(origin, 0, open, visionConfig.light),
  heading: 0,
  lightParams: visionConfig.light,
  rings,
  echo: visionConfig.echo,
});

describe('что видит игрок', () => {
  it('свет показывает близкое, но не далёкое', () => {
    const s = sight();
    expect(pointLit({ x: 11, y: -10 }, s)).toBe(true);
    expect(pointLit({ x: 10, y: -20 }, s)).toBe(false);
  });

  it('эхо показывает то, до чего дошёл фронт, пока не погасло свечение', () => {
    const origin = { x: 10, y: -10 };
    const ring: EchoRing = { origin, radius: 6, age: 6 / visionConfig.echo.speed, poly: echoVisibility(origin, open, visionConfig.echo) };
    const s = sight({ x: 50, y: -50 }, [ring]);
    expect(pointEchoed({ x: 15, y: -10 }, s)).toBe(true);
    expect(pointEchoed({ x: 18, y: -10 }, s)).toBe(false); // фронт ещё не дошёл
    ring.age += visionConfig.echo.glow + 1;
    expect(pointEchoed({ x: 15, y: -10 }, s)).toBe(false); // свечение погасло
  });
});

describe('слепок памяти', () => {
  it('запоминает, где видел, и не двигается, пока вещь не видна', () => {
    const rec = createRecollection();
    const thing = { pos: { x: 11, y: -10 }, angle: 0.1, radius: 0.5, exists: true };
    updateRecollection(rec, thing, sight());
    expect(rec).toMatchObject({ known: true, pos: { x: 11, y: -10 } });
    // Игрок ушёл далеко, вещь уплыла — слепок на старом месте.
    thing.pos = { x: 13, y: -10 };
    updateRecollection(rec, thing, sight({ x: 40, y: -40 }));
    expect(rec.pos).toEqual({ x: 11, y: -10 });
  });

  it('стирается, когда место видно, а вещи там нет', () => {
    const rec = createRecollection();
    const thing = { pos: { x: 11, y: -10 }, angle: 0, radius: 0.5, exists: true };
    updateRecollection(rec, thing, sight());
    thing.exists = false; // собрали
    updateRecollection(rec, thing, sight());
    expect(rec.known).toBe(false);
  });
});
