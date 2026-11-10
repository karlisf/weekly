/*
 * Merge rule: each field group keeps the value with the newest clock.
 * The rule is commutative, associative and idempotent, so devices that have
 * seen the same changes show the same task, in whatever order they arrived.
 */
import type { Clocks, FieldKey, Task } from '../db/schema';

export const FIELD_COLUMNS: Record<FieldKey, (keyof Task)[]> = {
  title: ['title'],
  notes: ['notes'],
  dates: ['startDate', 'endDate'],
  done: ['doneAt'],
  order: ['sortOrder'],
  deleted: ['deletedAt'],
};

export const FIELD_KEYS = Object.keys(FIELD_COLUMNS) as FieldKey[];

/** Field groups touched by a patch of task columns. */
export function fieldsOf(patch: Partial<Task>): FieldKey[] {
  return FIELD_KEYS.filter((k) => FIELD_COLUMNS[k].some((c) => c in patch));
}

export function stamp(clocks: Clocks, fields: FieldKey[], ts: string): Clocks {
  const out = { ...clocks };
  for (const f of fields) out[f] = ts;
  return out;
}

/** Merge a remote copy of a task into the local one. `changed` = local row must be rewritten. */
export function mergeTask(local: Task | undefined, remote: Task): { task: Task; changed: boolean } {
  if (!local) return { task: { ...remote, clocks: { ...remote.clocks } }, changed: true };
  const task: Task = { ...local, clocks: { ...local.clocks } };
  let changed = false;
  for (const f of FIELD_KEYS) {
    const r = remote.clocks[f] ?? '';
    const l = local.clocks[f] ?? '';
    if (r > l) {
      for (const c of FIELD_COLUMNS[f]) (task as Record<string, unknown>)[c] = remote[c];
      task.clocks[f] = r;
      changed = true;
    }
  }
  if (remote.createdAt < task.createdAt) {
    task.createdAt = remote.createdAt;
    changed = true;
  }
  if (changed) task.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return { task, changed };
}

/** Highest clock in a task, used to restore the HLC on startup. */
export function maxClock(t: Task): string {
  let m = '';
  for (const v of Object.values(t.clocks)) if (v && v > m) m = v;
  return m;
}
