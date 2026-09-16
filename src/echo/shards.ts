import type { Vec2 } from '../math/vec2';

export interface ShardParams {
  /** В этом радиусе осколок притягивается к игроку, ед. */
  magnetRadius: number;
  /** Ускорение притяжения, ед./с². */
  magnetAccel: number;
  /** На таком расстоянии осколок считается подобранным, ед. */
  pickupRadius: number;
}

/**
 * Осколки памяти (§8): не возрождаются, в груз не идут. Лёгкий магнит (решение пользователя):
 * рядом с игроком осколок срывается с места и влетает в существо.
 */
export class ShardField {
  readonly pos: Vec2[];
  readonly alive: boolean[];
  readonly vel: Vec2[];
  readonly magnetized: boolean[];
  /** Подобранные на последнем шаге — для эффектов. */
  readonly picked: number[] = [];

  constructor(private readonly initial: readonly Vec2[]) {
    const positions = initial;
    this.pos = positions.map((p) => ({ ...p }));
    this.alive = positions.map(() => true);
    this.vel = positions.map(() => ({ x: 0, y: 0 }));
    this.magnetized = positions.map(() => false);
  }

  reset(): void {
    this.initial.forEach((p, i) => {
      this.pos[i] = { ...p };
      this.vel[i] = { x: 0, y: 0 };
      this.alive[i] = true;
      this.magnetized[i] = false;
    });
  }

  get remaining(): number {
    return this.alive.filter(Boolean).length;
  }

  /** Возвращает число подобранных за шаг осколков. */
  step(player: Vec2, dt: number, p: ShardParams): number {
    this.picked.length = 0;
    for (let i = 0; i < this.pos.length; i++) {
      if (!this.alive[i]) continue;
      const s = this.pos[i];
      const dx = player.x - s.x;
      const dy = player.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d <= p.pickupRadius) {
        this.alive[i] = false;
        this.picked.push(i);
        continue;
      }
      // Схваченный магнитом осколок уже не отпускается — догоняет игрока, даже если тот ускорился.
      if (d <= p.magnetRadius) this.magnetized[i] = true;
      if (!this.magnetized[i]) continue;
      const v = this.vel[i];
      v.x += (dx / d) * p.magnetAccel * dt;
      v.y += (dy / d) * p.magnetAccel * dt;
      // Скорость направлена к игроку: без орбит вокруг него.
      const speed = Math.hypot(v.x, v.y);
      v.x = (dx / d) * speed;
      v.y = (dy / d) * speed;
      const move = Math.min(speed * dt, d);
      s.x += (dx / d) * move;
      s.y += (dy / d) * move;
    }
    return this.picked.length;
  }
}
