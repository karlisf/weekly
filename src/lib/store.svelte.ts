import { eq, isNull } from 'drizzle-orm';
import { openDatabase, type Database } from '../db/client';
import { outbox, settings as settingsTable, tasks as tasksTable, type Clocks, type Task } from '../db/schema';
import { addDays, isValidDay, startOfWeek, today as todayDay, weekDays, type Day } from './dates';
import { byOrder, datesAfterMove, isUnscheduled, orderBetween, placementsForDay } from './plan';
import { seedTasks } from './seed';
import { Hlc, encode } from '../sync/hlc';
import { FIELD_KEYS, fieldsOf, maxClock, mergeTask, stamp } from '../sync/merge';
import { SyncEngine, type SpaceConfig } from '../sync/engine.svelte';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  /** Show open "no date" tasks in a pencilled-in section on today's column. */
  unscheduledOnToday: boolean;
  /** Show open delayed tasks in a "carried over" section on today's column. */
  delayedOnToday: boolean;
  /** Random per-install id; also the node id in sync clocks. */
  deviceId: string;
  seeded: boolean;
  /** Name shown to other devices in a sync space. Empty = guessed from the browser. */
  deviceName: string;
  /** Sync space this device belongs to, or null. */
  sync: SpaceConfig | null;
  /** Newest relay event time seen (unix seconds). */
  syncCursor: number;
  /** This device's Nostr signing key (hex). Never leaves the device. */
  nostrKey: string;
}

const DEFAULTS: Settings = {
  theme: 'system',
  unscheduledOnToday: true,
  delayedOnToday: false,
  deviceId: '',
  seeded: false,
  deviceName: '',
  sync: null,
  syncCursor: 0,
  nostrKey: '',
};

export type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'busy' } // another tab holds the database
  | { kind: 'released' } // we handed the database to another tab
  | { kind: 'error'; message: string };

/** Where a dragged task was dropped. day = null means "No date". */
export interface DropTarget {
  day: Day | null;
  beforeId?: string;
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

const uuid = () => crypto.randomUUID();
const LOCK = 'weekly-db';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('weekly') : null;

class AppStore {
  status = $state<Status>({ kind: 'loading' });
  persistent = $state(true);
  tasks = $state<Task[]>([]);
  settings = $state<Settings>({ ...DEFAULTS });
  today = $state<Day>(todayDay());
  weekStart = $state<Day>(startOfWeek(todayDay()));
  openTaskId = $state<string | null>(null);
  /** Day the user clicked in the desktop grid; it gets the wide column. */
  focusDay = $state<Day | null>(null);
  /** Day whose quick-add input should open (keyboard shortcut N). */
  quickAddDay = $state<Day | null>(null);
  toasts = $state<Toast[]>([]);

  readonly sync: SyncEngine;

  private database: Database | null = null;
  private clock: Hlc | null = null;
  private releaseLock: (() => void) | null = null;
  private toastSeq = 0;

  constructor() {
    this.sync = new SyncEngine({
      db: () => this.db,
      hlc: () => this.hlc,
      getSetting: <T>(key: string) => (this.settings as unknown as Record<string, unknown>)[key] as T | undefined,
      setSetting: (key, value) => this.setSetting(key as keyof Settings, value as never),
      onRemoteTasks: (rows) => this.onRemoteTasks(rows),
      clearLocalTasks: async () => {
        await this.db.delete(tasksTable);
        await this.db.delete(outbox);
        this.tasks = [];
      },
    });
  }

  /** The wide column: the focused day, else today when it is in the shown week. */
  get wideDay(): Day | null {
    const days = weekDays(this.weekStart);
    if (this.focusDay && days.includes(this.focusDay)) return this.focusDay;
    return days.includes(this.today) ? this.today : null;
  }

  get openTask(): Task | undefined {
    return this.tasks.find((t) => t.id === this.openTaskId);
  }

  // ---------- lifecycle ----------

  async start() {
    channel?.addEventListener('message', (ev) => {
      if (ev.data === 'takeover' && this.status.kind === 'ready') void this.handOver();
    });
    this.watchClock();
    if (!('locks' in navigator)) return this.open();
    const got = await this.acquireLock(true);
    if (got) await this.open();
    else this.status = { kind: 'busy' };
  }

  /** Ask the tab that holds the database to let go, then open it here. */
  async takeOver() {
    this.status = { kind: 'loading' };
    channel?.postMessage('takeover');
    if ('locks' in navigator) await this.acquireLock(false);
    await this.open();
  }

  private acquireLock(ifAvailable: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      navigator.locks
        .request(LOCK, { ifAvailable }, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          return new Promise<void>((r) => (this.releaseLock = r));
        })
        .catch(() => resolve(false));
    });
  }

  private async handOver() {
    this.openTaskId = null;
    this.sync.stop();
    const db = this.database;
    this.database = null;
    await db?.close();
    this.releaseLock?.();
    this.releaseLock = null;
    this.status = { kind: 'released' };
  }

  private async open() {
    try {
      this.database = await openDatabase();
      this.persistent = this.database.info.persistent;
      if (this.persistent) void navigator.storage?.persist?.();
      await this.loadSettings();
      this.clock = new Hlc(this.settings.deviceId.replace(/-/g, '').slice(0, 8));
      await this.prepareClocks();
      if (!this.settings.seeded) await this.seed();
      await this.reload();
      this.status = { kind: 'ready' };
      await this.sync.start();
    } catch (err) {
      console.error(err);
      this.status = { kind: 'error', message: String((err as Error)?.message ?? err) };
    }
  }

  /**
   * Restore the clock past every stored timestamp, and give tasks created
   * before sync existed a clock derived from their last edit time.
   */
  private async prepareClocks() {
    const all = await this.db.select().from(tasksTable);
    const legacy: Task[] = [];
    for (const t of all) {
      this.hlc.observe(maxClock(t));
      if (FIELD_KEYS.some((k) => !t.clocks[k])) legacy.push(t);
    }
    if (!legacy.length) return;
    const writes = legacy.map((t) => {
      const ts = encode(t.updatedAt, 0, this.hlc.node);
      const clocks: Clocks = { ...t.clocks };
      for (const k of FIELD_KEYS) clocks[k] ??= ts;
      return this.db.update(tasksTable).set({ clocks }).where(eq(tasksTable.id, t.id));
    });
    await this.db.batch(writes as [(typeof writes)[number], ...typeof writes]);
  }

  private watchClock() {
    const tick = () => {
      const now = todayDay();
      if (now === this.today) return;
      const wasCurrentWeek = this.weekStart === startOfWeek(this.today);
      this.today = now;
      if (wasCurrentWeek) this.weekStart = startOfWeek(now);
    };
    setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
  }

  private get db() {
    if (!this.database) throw new Error('Database is not open');
    return this.database.db;
  }

  private get hlc() {
    if (!this.clock) throw new Error('Clock is not ready');
    return this.clock;
  }

  async reload() {
    this.tasks = await this.db.select().from(tasksTable).where(isNull(tasksTable.deletedAt));
  }

  /** Apply a change locally first so the UI never waits on storage; resync on failure. */
  private async persist(work: () => Promise<unknown>) {
    try {
      await work();
    } catch (err) {
      console.error(err);
      this.toast(`Couldn't save the change: ${(err as Error).message}`);
      await this.reload();
    }
  }

  /** Write a task and queue it for sync. */
  private async save(t: Task) {
    const row = $state.snapshot(t) as Task;
    await this.persist(async () => {
      await this.db.insert(tasksTable).values(row).onConflictDoUpdate({ target: tasksTable.id, set: row });
      await this.sync.enqueue([row.id]);
    });
  }

  /** Remote changes arrived: update the in-memory list to match. */
  private onRemoteTasks(rows: Task[]) {
    const byId = new Map(this.tasks.map((t) => [t.id, t]));
    for (const r of rows) {
      if (r.deletedAt != null) byId.delete(r.id);
      else byId.set(r.id, r);
    }
    this.tasks = [...byId.values()];
    if (this.openTaskId && !byId.has(this.openTaskId)) this.openTaskId = null;
  }

  // ---------- settings ----------

  private async loadSettings() {
    const rows = await this.db.select().from(settingsTable);
    const loaded: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        loaded[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore malformed */
      }
    }
    this.settings = { ...DEFAULTS, ...loaded } as Settings;
    if (!this.settings.deviceId) await this.setSetting('deviceId', uuid());
  }

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value;
    const row = { key, value: JSON.stringify(value), updatedAt: Date.now() };
    await this.persist(() =>
      this.db.insert(settingsTable).values(row).onConflictDoUpdate({ target: settingsTable.key, set: row }),
    );
  }

  private async seed() {
    const ts = this.hlc.tick();
    const rows = seedTasks(this.today).map((t) => ({ ...t, clocks: stamp({}, FIELD_KEYS, ts) }));
    if (rows.length) await this.db.insert(tasksTable).values(rows);
    await this.setSetting('seeded', true);
  }

  // ---------- navigation ----------

  goWeek(delta: number) {
    this.weekStart = addDays(this.weekStart, 7 * delta);
    this.focusDay = null;
  }

  /** Show the week containing `day` with that day in focus (widened on desktop, scrolled to on phones). */
  goToDay(day: Day) {
    this.weekStart = startOfWeek(day);
    this.focusDay = day;
  }

  goToday() {
    this.weekStart = startOfWeek(this.today);
    this.focusDay = null;
  }

  // ---------- tasks ----------

  /** Tasks shown in a list, in display order, so new/moved tasks can be ordered against them. */
  private siblings(day: Day | null, excludeId?: string): Task[] {
    const list =
      day == null
        ? this.tasks.filter((t) => isUnscheduled(t) && t.doneAt == null)
        : placementsForDay(this.tasks, day, this.today, this.weekStart).map((p) => p.task);
    return list.filter((t) => t.id !== excludeId).sort(byOrder);
  }

  async addTask(title: string, day: Day | null): Promise<Task | undefined> {
    title = title.trim();
    if (!title) return;
    const sib = this.siblings(day);
    const now = Date.now();
    const task: Task = {
      id: uuid(),
      title,
      notes: '',
      startDate: day,
      endDate: null,
      doneAt: null,
      sortOrder: orderBetween(sib.at(-1)?.sortOrder, undefined),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      clocks: stamp({}, FIELD_KEYS, this.hlc.tick()),
    };
    this.tasks.push(task);
    await this.save(task);
    return task;
  }

  async updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt' | 'clocks'>>) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const clean: Partial<Task> = { ...patch };
    if ('startDate' in clean && clean.startDate != null && !isValidDay(clean.startDate)) delete clean.startDate;
    Object.assign(t, clean);
    // Keep spans valid: an end before the start, or without a start, is dropped.
    if (t.startDate == null || (t.endDate != null && t.endDate <= t.startDate)) {
      if (t.endDate != null) clean.endDate = t.endDate = null;
    }
    const fields = fieldsOf(clean);
    if (!fields.length) return;
    t.updatedAt = Date.now();
    t.clocks = stamp(t.clocks, fields, this.hlc.tick());
    await this.save(t);
  }

  toggleDone(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (t) void this.updateTask(id, { doneAt: t.doneAt == null ? Date.now() : null });
  }

  async deleteTask(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const removed: Task = {
      ...$state.snapshot(t),
      deletedAt: Date.now(),
      updatedAt: Date.now(),
      clocks: stamp(t.clocks, ['deleted'], this.hlc.tick()),
    } as Task;
    this.tasks = this.tasks.filter((x) => x.id !== id);
    if (this.openTaskId === id) this.openTaskId = null;
    await this.save(removed);
    this.toast(`Deleted "${t.title}"`, {
      label: 'Undo',
      run: async () => {
        const restored: Task = {
          ...removed,
          deletedAt: null,
          updatedAt: Date.now(),
          clocks: stamp(removed.clocks, ['deleted'], this.hlc.tick()),
        };
        this.tasks.push(restored);
        await this.save(restored);
      },
    });
  }

  /** Drop handler: reschedule (or unschedule) and reorder. */
  async moveTask(id: string, fromDay: Day | null, target: DropTarget) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const patch: Partial<Task> = {};
    if (target.day == null) {
      patch.startDate = null;
      patch.endDate = null;
    } else if (fromDay !== target.day) {
      Object.assign(patch, datesAfterMove(t, fromDay, target.day));
    }
    const sib = this.siblings(target.day, id);
    const idx = target.beforeId ? sib.findIndex((s) => s.id === target.beforeId) : -1;
    if (idx >= 0) patch.sortOrder = orderBetween(sib[idx - 1]?.sortOrder, sib[idx].sortOrder);
    else if (target.beforeId === undefined) patch.sortOrder = orderBetween(sib.at(-1)?.sortOrder, undefined);
    await this.updateTask(id, patch);
  }

  // ---------- backup ----------

  async exportJson(): Promise<Blob> {
    const all = await this.db.select().from(tasksTable);
    const data = { app: 'weekly', version: 2, exportedAt: new Date().toISOString(), tasks: all };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  /** Merge a backup with the same per-field rule sync uses, so importing twice is harmless. */
  async importJson(text: string): Promise<number> {
    const data = JSON.parse(text);
    if (data?.app !== 'weekly' || !Array.isArray(data.tasks)) throw new Error('This file is not a Weekly backup.');
    const existing = new Map((await this.db.select().from(tasksTable)).map((t) => [t.id, t]));
    const changed: Task[] = [];
    for (const raw of data.tasks as Task[]) {
      if (typeof raw?.id !== 'string' || typeof raw.title !== 'string') continue;
      const updatedAt = Number(raw.updatedAt) || Date.now();
      // Backups from before sync have no clocks: date them by their last edit.
      const fallback = encode(updatedAt, 0, 'backup');
      const clocks: Clocks = {};
      for (const k of FIELD_KEYS) clocks[k] = typeof raw.clocks?.[k] === 'string' ? raw.clocks[k] : fallback;
      const row: Task = {
        id: raw.id,
        title: raw.title,
        notes: typeof raw.notes === 'string' ? raw.notes : '',
        startDate: isValidDay(raw.startDate) ? raw.startDate : null,
        endDate: isValidDay(raw.endDate) ? raw.endDate : null,
        doneAt: typeof raw.doneAt === 'number' ? raw.doneAt : null,
        sortOrder: Number(raw.sortOrder) || 0,
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt,
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : null,
        clocks,
      };
      for (const c of Object.values(clocks)) this.hlc.observe(c);
      const { task, changed: did } = mergeTask(existing.get(row.id), row);
      if (!did) continue;
      await this.db.insert(tasksTable).values(task).onConflictDoUpdate({ target: tasksTable.id, set: task });
      changed.push(task);
    }
    await this.sync.enqueue(changed.map((t) => t.id));
    await this.reload();
    return changed.length;
  }

  async exportDatabaseFile(): Promise<Uint8Array> {
    return this.database!.exportFile();
  }

  // ---------- toasts ----------

  toast(text: string, action?: Toast['action'], ms = 6000) {
    const id = ++this.toastSeq;
    this.toasts.push({ id, text, action });
    setTimeout(() => this.dismissToast(id), ms);
  }

  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new AppStore();
