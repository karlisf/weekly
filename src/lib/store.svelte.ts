import { eq, isNull } from 'drizzle-orm';
import { openDatabase, type Database } from '../db/client';
import { settings as settingsTable, tasks as tasksTable, type Task } from '../db/schema';
import { addDays, isValidDay, startOfWeek, today as todayDay, type Day } from './dates';
import { byOrder, datesAfterMove, isUnscheduled, orderBetween, placementsForDay } from './plan';
import { seedTasks } from './seed';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  /** Show open "no date" tasks in a pencilled-in section on today's column. */
  unscheduledOnToday: boolean;
  /** Random per-install id; future sync uses it to tell devices apart. */
  deviceId: string;
  seeded: boolean;
}

const DEFAULTS: Settings = { theme: 'system', unscheduledOnToday: true, deviceId: '', seeded: false };

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
  /** Day whose quick-add input should open (keyboard shortcut N). */
  quickAddDay = $state<Day | null>(null);
  toasts = $state<Toast[]>([]);

  private database: Database | null = null;
  private releaseLock: (() => void) | null = null;
  private toastSeq = 0;

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
      if (!this.settings.seeded) await this.seed();
      await this.reload();
      this.status = { kind: 'ready' };
    } catch (err) {
      console.error(err);
      this.status = { kind: 'error', message: String((err as Error)?.message ?? err) };
    }
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
    const rows = seedTasks(this.today);
    if (rows.length) await this.db.insert(tasksTable).values(rows);
    await this.setSetting('seeded', true);
  }

  // ---------- navigation ----------

  goWeek(delta: number) {
    this.weekStart = addDays(this.weekStart, 7 * delta);
  }

  goToday() {
    this.weekStart = startOfWeek(this.today);
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
    };
    this.tasks.push(task);
    await this.persist(() => this.db.insert(tasksTable).values(task));
    return task;
  }

  async updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const clean = { ...patch, updatedAt: Date.now() };
    if ('startDate' in clean && clean.startDate != null && !isValidDay(clean.startDate)) delete clean.startDate;
    Object.assign(t, clean);
    // Keep spans valid: an end before the start, or without a start, is dropped.
    if (t.startDate == null || (t.endDate != null && t.endDate <= t.startDate)) {
      if (t.endDate != null) clean.endDate = t.endDate = null;
    }
    await this.persist(() => this.db.update(tasksTable).set(clean).where(eq(tasksTable.id, id)));
  }

  toggleDone(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (t) void this.updateTask(id, { doneAt: t.doneAt == null ? Date.now() : null });
  }

  async deleteTask(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const now = Date.now();
    this.tasks = this.tasks.filter((x) => x.id !== id);
    if (this.openTaskId === id) this.openTaskId = null;
    await this.persist(() =>
      this.db.update(tasksTable).set({ deletedAt: now, updatedAt: now }).where(eq(tasksTable.id, id)),
    );
    this.toast(`Deleted "${t.title}"`, {
      label: 'Undo',
      run: async () => {
        const restored = { ...t, deletedAt: null, updatedAt: Date.now() };
        this.tasks.push(restored);
        await this.persist(() =>
          this.db
            .update(tasksTable)
            .set({ deletedAt: null, updatedAt: restored.updatedAt })
            .where(eq(tasksTable.id, id)),
        );
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
    const data = { app: 'weekly', version: 1, exportedAt: new Date().toISOString(), tasks: all };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  /** Merge a backup: rows with a newer updatedAt win, so importing twice is harmless. */
  async importJson(text: string): Promise<number> {
    const data = JSON.parse(text);
    if (data?.app !== 'weekly' || !Array.isArray(data.tasks)) throw new Error('This file is not a Weekly backup.');
    const existing = new Map((await this.db.select().from(tasksTable)).map((t) => [t.id, t]));
    let changed = 0;
    for (const raw of data.tasks as Task[]) {
      if (typeof raw?.id !== 'string' || typeof raw.title !== 'string') continue;
      const row: Task = {
        id: raw.id,
        title: raw.title,
        notes: typeof raw.notes === 'string' ? raw.notes : '',
        startDate: isValidDay(raw.startDate) ? raw.startDate : null,
        endDate: isValidDay(raw.endDate) ? raw.endDate : null,
        doneAt: typeof raw.doneAt === 'number' ? raw.doneAt : null,
        sortOrder: Number(raw.sortOrder) || 0,
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : null,
      };
      const cur = existing.get(row.id);
      if (cur && cur.updatedAt >= row.updatedAt) continue;
      await this.db.insert(tasksTable).values(row).onConflictDoUpdate({ target: tasksTable.id, set: row });
      changed++;
    }
    await this.reload();
    return changed;
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
