import { describe, expect, it } from 'vitest';
import { Hlc, decode } from './hlc';
import { mergeTask, stamp, fieldsOf } from './merge';
import { deriveSpace, derivePairing, normalizeCode, newPairingCode, open, randomBytes, seal, formatCode } from './crypto';
import type { Task } from '../db/schema';

describe('hlc', () => {
  it('is monotonic even when the wall clock stands still or goes back', () => {
    let now = 1000;
    const c = new Hlc('a', () => now);
    const a = c.tick();
    const b = c.tick();
    now = 500;
    const d = c.tick();
    expect(a < b && b < d).toBe(true);
  });
  it('moves past remote timestamps from a device whose clock is ahead', () => {
    const ahead = new Hlc('b', () => 9_000).tick();
    const c = new Hlc('a', () => 1_000);
    c.observe(ahead);
    const next = c.tick();
    expect(next > ahead).toBe(true);
    expect(decode(next).wall).toBe(9_000);
  });
});

const base = (o: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'A',
  notes: '',
  startDate: '2026-11-10',
  endDate: null,
  doneAt: null,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  clocks: { title: '1', notes: '1', dates: '1', done: '1', order: '1', deleted: '1' },
  ...o,
});

/** Simulated device: a task replica plus its own clock. */
function edit(t: Task, patch: Partial<Task>, ts: string): Task {
  return { ...t, ...patch, clocks: stamp(t.clocks, fieldsOf(patch), ts) };
}

describe('merge', () => {
  it('keeps concurrent edits to different fields', () => {
    const phone = edit(base(), { title: 'Call the dentist' }, '2');
    const laptop = edit(base(), { startDate: '2026-11-12', endDate: '2026-11-13' }, '3');
    const onLaptop = mergeTask(laptop, phone).task;
    const onPhone = mergeTask(phone, laptop).task;
    expect(onLaptop).toEqual(onPhone);
    expect(onLaptop).toMatchObject({ title: 'Call the dentist', startDate: '2026-11-12', endDate: '2026-11-13' });
  });

  it('lets the newer edit of the same field win, and moves dates as one unit', () => {
    const a = edit(base(), { startDate: '2026-11-11' }, '2');
    const b = edit(base(), { startDate: '2026-11-14', endDate: '2026-11-16' }, '3');
    expect(mergeTask(a, b).task).toMatchObject({ startDate: '2026-11-14', endDate: '2026-11-16' });
    expect(mergeTask(b, a).task).toMatchObject({ startDate: '2026-11-14', endDate: '2026-11-16' });
  });

  it('is idempotent and reports when nothing changed', () => {
    const a = edit(base(), { title: 'X' }, '2');
    const once = mergeTask(base(), a).task;
    expect(mergeTask(once, a).changed).toBe(false);
  });

  it('converges whatever order changes arrive in', () => {
    const edits = [
      edit(base(), { title: 'one' }, '5'),
      edit(base(), { doneAt: 99 }, '4'),
      edit(base(), { deletedAt: 7 }, '6'),
      edit(base(), { title: 'two', notes: 'n' }, '3'),
    ];
    const orders = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
    ];
    const results = orders.map((o) => o.reduce((acc, i) => mergeTask(acc, edits[i]).task, base()));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toMatchObject({ title: 'one', notes: 'n', doneAt: 99, deletedAt: 7 });
  });

  it('accepts a task it has never seen', () => {
    expect(mergeTask(undefined, base()).changed).toBe(true);
  });
});

describe('crypto', () => {
  it('encrypts and decrypts with the space key, and derives a stable tag', async () => {
    const key = randomBytes(32);
    const s1 = await deriveSpace(key);
    const s2 = await deriveSpace(key);
    expect(s1.tag).toBe(s2.tag);
    expect(await s1.itemTag('task/1')).toBe(await s2.itemTag('task/1'));
    expect(await open(s2.aes, await seal(s1.aes, { hi: 1 }))).toEqual({ hi: 1 });
    const other = await deriveSpace(randomBytes(32));
    await expect(open(other.aes, await seal(s1.aes, { hi: 1 }))).rejects.toThrow();
  });

  it('pairs with a code typed sloppily, and fails with a wrong code', async () => {
    const code = newPairingCode();
    const typed = formatCode(code).toLowerCase().replace(/-/g, ' ');
    expect(normalizeCode(typed)).toBe(code);
    expect(normalizeCode('too-short')).toBeNull();
    const a = await derivePairing(code, 1000);
    const b = await derivePairing(normalizeCode(typed)!, 1000);
    expect(b.tag).toBe(a.tag);
    expect(await open(b.aes, await seal(a.aes, 'secret'))).toBe('secret');
    const wrong = await derivePairing(newPairingCode(), 1000);
    expect(wrong.tag).not.toBe(a.tag);
  });
});
