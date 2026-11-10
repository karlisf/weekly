/*
 * Hybrid logical clock. Timestamps are wall-clock milliseconds plus a counter
 * plus the device id, encoded so that plain string comparison orders them:
 *   "<wall base36, 9 chars>-<counter base36, 4 chars>-<node>"
 * The clock never goes backwards, and after seeing a remote timestamp every
 * later local timestamp is greater, even if this device's clock is behind.
 */
export type Timestamp = string;

const WALL = 9;
const COUNT = 4;
const MAX_COUNT = 36 ** COUNT - 1;

export function encode(wall: number, counter: number, node: string): Timestamp {
  return `${wall.toString(36).padStart(WALL, '0')}-${counter.toString(36).padStart(COUNT, '0')}-${node}`;
}

export function decode(ts: Timestamp): { wall: number; counter: number; node: string } {
  const [w, c, ...rest] = ts.split('-');
  return { wall: parseInt(w, 36), counter: parseInt(c, 36), node: rest.join('-') };
}

export class Hlc {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly node: string,
    private now: () => number = Date.now,
  ) {}

  /** Timestamp for a local change. */
  tick(): Timestamp {
    const t = this.now();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else {
      this.bump();
    }
    return encode(this.wall, this.counter, this.node);
  }

  /** Advance past a timestamp seen from another device (or loaded from disk). */
  observe(ts: Timestamp | undefined) {
    if (!ts) return;
    const r = decode(ts);
    if (!Number.isFinite(r.wall)) return;
    const t = this.now();
    const wall = Math.max(t, this.wall, r.wall);
    if (wall === this.wall && wall === r.wall) this.counter = Math.max(this.counter, r.counter);
    else if (wall === r.wall) this.counter = r.counter;
    else if (wall !== this.wall) this.counter = -1;
    this.wall = wall;
    if (this.counter < 0) this.counter = 0;
  }

  private bump() {
    if (this.counter >= MAX_COUNT) {
      this.wall += 1;
      this.counter = 0;
    } else this.counter++;
  }
}
