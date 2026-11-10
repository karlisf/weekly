/*
 * Sync over public Nostr relays.
 *
 * Every task is published as an encrypted, replaceable Nostr event (kind 30078,
 * "application data"). Relays keep the latest version per device and task, so
 * they act both as a live channel (subscriptions push new events immediately)
 * and as a mailbox for devices that were offline. Nothing on the relays is
 * readable without the space key: relays see only a random space tag, random
 * item tags, event sizes and times.
 *
 * Merging is per field, newest clock wins (see merge.ts), so applying the same
 * events twice or in any order gives the same result.
 */
import { SimplePool } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { eq, inArray, lte, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { outbox, tasks as tasksTable, type Task } from '../db/schema';
import type { Hlc } from './hlc';
import { mergeTask } from './merge';
import {
  deriveSpace,
  derivePairing,
  fromB64,
  newPairingCode,
  normalizeCode,
  open,
  randomBytes,
  seal,
  toB64,
  toHex,
  type SpaceKeys,
} from './crypto';

export const KIND = 30078;
const INVITE_TTL_S = 10 * 60;
const LOOKBACK_S = 24 * 3600; // re-read a day of events to tolerate clock skew between devices
const PRESENCE_EVERY_MS = 5 * 60_000;

export const DEFAULT_RELAYS: string[] = (
  import.meta.env.VITE_DEFAULT_RELAYS ??
  // Chosen with Relays → Test relays: these accept, store and return Weekly's events.
  'wss://relay.snort.social,wss://offchain.pub,wss://nostr.oxtr.dev,wss://relay.nostr.net,wss://nos.lol,wss://relay.damus.io'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

const FIRST_DEFAULTS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
const sameSet = (a: string[], b: string[]) => a.length === b.length && b.every((x) => a.includes(x));

/** More public relays, tried by the relay test and when looking up pairing codes. */
export const CANDIDATE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostr.bg',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.net',
];

/** Where pairing codes are posted and looked up: wide, so two devices on different networks overlap. */
const pairingRelays = (extra: string[] = []) => [...new Set([...extra, ...DEFAULT_RELAYS, ...CANDIDATE_RELAYS])];

export interface SpaceConfig {
  /** Base64url space key. Whoever has it can read and write the space. */
  key: string;
  name: string;
  relays: string[];
  joinedAt: number;
}

export interface Invite {
  key: string;
  name: string;
  relays: string[];
  from: string;
}

export interface Device {
  pubkey: string;
  name: string;
  lastSeen: number;
  me: boolean;
}

type Payload = { type: 'task'; task: Task } | { type: 'device'; name: string; lastSeen: number };

export interface SyncHost {
  db(): Db;
  hlc(): Hlc;
  getSetting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): Promise<void>;
  /** Called after remote changes were written to the database. */
  onRemoteTasks(rows: Task[]): void;
  /** Delete all local tasks (used when joining a space with "replace"). */
  clearLocalTasks(): Promise<void>;
}

export type SyncStatus = 'off' | 'connecting' | 'online' | 'offline';

export class SyncEngine {
  status = $state<SyncStatus>('off');
  space = $state<SpaceConfig | null>(null);
  pending = $state(0);
  lastSyncAt = $state<number | null>(null);
  relayState = $state<Record<string, boolean>>({});
  devices = $state<Device[]>([]);
  lastError = $state<string | null>(null);

  private pool: SimplePool | null = null;
  private keys: SpaceKeys | null = null;
  private sub: { close: () => void } | null = null;
  private secret: Uint8Array | null = null;
  private inbox: Event[] = [];
  private inboxTimer: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastCreatedAt = new Map<string, number>();
  private devicesMap = new Map<string, Device>();
  private onOnline = () => {
    this.status = 'connecting';
    this.restartSubscription();
    this.scheduleFlush(0);
  };
  private onOffline = () => (this.status = 'offline');

  constructor(private host: SyncHost) {}

  get enabled() {
    return this.space != null;
  }

  get deviceName(): string {
    return this.host.getSetting<string>('deviceName') || guessDeviceName();
  }

  // ---------- lifecycle ----------

  async start() {
    this.space = this.host.getSetting<SpaceConfig>('sync') ?? null;
    // Spaces created with the first release's defaults: primal doesn't store our events
    // and the rest are blocked on many networks, so move them to the current defaults.
    if (this.space && sameSet(this.space.relays, FIRST_DEFAULTS)) {
      this.space = { ...this.space, relays: [...DEFAULT_RELAYS] };
      await this.host.setSetting('sync', this.space);
    }
    await this.countPending();
    if (!this.space) return;
    this.secret = await this.ensureDeviceKey();
    this.keys = await deriveSpace(fromB64(this.space.key));
    this.pool = new SimplePool({ enablePing: true, enableReconnect: true });
    this.startedAt = Date.now();
    this.pool.onRelayConnectionSuccess = () => this.refreshRelayState();
    this.pool.onRelayConnectionFailure = () => this.refreshRelayState();
    this.status = navigator.onLine ? 'connecting' : 'offline';
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.restartSubscription();
    this.timers.push(setInterval(() => this.scheduleFlush(0), 30_000));
    this.timers.push(setInterval(() => void this.announce(), PRESENCE_EVERY_MS));
    this.timers.push(setInterval(() => this.refreshRelayState(), 5_000));
    void this.announce();
    this.scheduleFlush(0);
  }

  stop() {
    this.sub?.close();
    this.sub = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    clearTimeout(this.flushTimer);
    clearTimeout(this.inboxTimer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.pool?.destroy();
    this.pool = null;
    this.keys = null;
    this.status = 'off';
    this.relayState = {};
  }

  private async ensureDeviceKey(): Promise<Uint8Array> {
    let hex = this.host.getSetting<string>('nostrKey');
    if (!hex) {
      hex = toHex(generateSecretKey());
      await this.host.setSetting('nostrKey', hex);
    }
    return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  }

  get pubkey(): string | null {
    return this.secret ? getPublicKey(this.secret) : null;
  }

  private startedAt = 0;

  private refreshRelayState() {
    if (!this.pool || !this.space) return;
    const st = this.pool.listConnectionStatus();
    const next: Record<string, boolean> = {};
    for (const r of this.space.relays) next[r] = st.get(safeNormalize(r)) ?? false;
    this.relayState = next;
    const any = Object.values(next).some(Boolean);
    if (!navigator.onLine) this.status = 'offline';
    else if (!any && this.status === 'online') this.status = 'connecting';
    if (!any && navigator.onLine && Date.now() - this.startedAt > 12_000)
      this.lastError =
        "Can't reach any relay from this network. A firewall, VPN, DNS filter or browser extension may be blocking them. Open Relays → Test relays.";
    else if (any && this.lastError?.startsWith("Can't reach any relay")) this.lastError = null;
  }

  // ---------- receiving ----------

  private restartSubscription() {
    if (!this.pool || !this.keys || !this.space) return;
    this.sub?.close();
    const cursor = this.host.getSetting<number>('syncCursor') ?? 0;
    const filter: Record<string, unknown> = { kinds: [KIND], '#w': [this.keys.tag] };
    if (cursor) filter.since = Math.max(0, cursor - LOOKBACK_S);
    this.sub = this.pool.subscribeMany(this.space.relays, filter as never, {
      onevent: (ev) => {
        this.inbox.push(ev);
        clearTimeout(this.inboxTimer);
        this.inboxTimer = setTimeout(() => void this.drainInbox(), 120);
      },
      oneose: () => {
        void this.drainInbox().then(() => {
          this.status = 'online';
          this.lastSyncAt = Date.now();
        });
      },
    });
  }

  private async drainInbox() {
    const batch = this.inbox;
    this.inbox = [];
    if (!batch.length || !this.keys) return;
    const remote: Task[] = [];
    let cursor = this.host.getSetting<number>('syncCursor') ?? 0;
    for (const ev of batch) {
      cursor = Math.max(cursor, ev.created_at);
      let payload: Payload;
      try {
        payload = await open<Payload>(this.keys.aes, ev.content);
      } catch {
        continue; // not ours, or corrupted
      }
      if (payload.type === 'task') remote.push(payload.task);
      else if (payload.type === 'device') this.seeDevice(ev.pubkey, payload.name, payload.lastSeen);
    }
    if (remote.length) await this.applyRemote(remote);
    if (cursor > (this.host.getSetting<number>('syncCursor') ?? 0)) await this.host.setSetting('syncCursor', cursor);
    this.lastSyncAt = Date.now();
  }

  private async applyRemote(rows: Task[]) {
    const db = this.host.db();
    const hlc = this.host.hlc();
    const ids = [...new Set(rows.map((r) => r.id))];
    const locals = new Map(
      (await db.select().from(tasksTable).where(inArray(tasksTable.id, ids))).map((t) => [t.id, t]),
    );
    const changed = new Map<string, Task>();
    for (const r of rows) {
      if (!isTaskShape(r)) continue;
      for (const c of Object.values(r.clocks)) hlc.observe(c);
      const local = changed.get(r.id) ?? locals.get(r.id);
      const { task, changed: did } = mergeTask(local, r);
      if (did) changed.set(r.id, task);
    }
    if (!changed.size) return;
    const writes = [...changed.values()].map((t) =>
      db.insert(tasksTable).values(t).onConflictDoUpdate({ target: tasksTable.id, set: t }),
    );
    await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
    this.host.onRemoteTasks([...changed.values()]);
  }

  private seeDevice(pubkey: string, name: string, lastSeen: number) {
    const d = { pubkey, name: String(name).slice(0, 60), lastSeen: Number(lastSeen) || 0, me: pubkey === this.pubkey };
    const cur = this.devicesMap.get(pubkey);
    if (cur && cur.lastSeen > d.lastSeen) return;
    this.devicesMap.set(pubkey, d);
    this.devices = [...this.devicesMap.values()].sort((a, b) => Number(b.me) - Number(a.me) || b.lastSeen - a.lastSeen);
  }

  // ---------- sending ----------

  /** Queue tasks for publishing (called by the store on every local change). */
  async enqueue(ids: string[]) {
    if (!this.space || !ids.length) return;
    const now = Date.now();
    const db = this.host.db();
    await db.batch(
      ids.map((id) =>
        db.insert(outbox).values({ taskId: id, queuedAt: now }).onConflictDoUpdate({
          target: outbox.taskId,
          set: { queuedAt: now },
        }),
      ) as never,
    );
    await this.countPending();
    this.scheduleFlush(800);
  }

  async enqueueAll() {
    const rows = await this.host.db().select({ id: tasksTable.id }).from(tasksTable);
    await this.enqueue(rows.map((r) => r.id));
  }

  private async countPending() {
    this.pending = (await this.host.db().select({ id: outbox.taskId }).from(outbox)).length;
  }

  private scheduleFlush(ms: number) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), ms);
  }

  async syncNow() {
    this.restartSubscription();
    await this.flush();
  }

  private async flush() {
    if (this.flushing || !this.pool || !this.keys || !this.space || !navigator.onLine) return;
    this.flushing = true;
    const db = this.host.db();
    try {
      const queue = await db.select().from(outbox).orderBy(outbox.queuedAt);
      for (const item of queue) {
        const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, item.taskId));
        if (task) {
          const ok = await this.publish(`task/${task.id}`, { type: 'task', task });
          if (!ok) break; // relays unreachable; keep the rest queued
        }
        // Only drop the entry if it wasn't re-queued by an edit made while publishing.
        await db.delete(outbox).where(and(eq(outbox.taskId, item.taskId), lte(outbox.queuedAt, item.queuedAt)));
        this.pending = Math.max(0, this.pending - 1);
        await sleep(120); // stay under public relays' rate limits
      }
      this.lastError = null;
    } catch (err) {
      this.lastError = String((err as Error)?.message ?? err);
    } finally {
      this.flushing = false;
      await this.countPending();
    }
  }

  private async announce() {
    if (!this.pubkey) return;
    await this.publish(`device/${this.pubkey}`, { type: 'device', name: this.deviceName, lastSeen: Date.now() });
    this.seeDevice(this.pubkey, this.deviceName, Date.now());
  }

  /** Sign and send one replaceable event. True if at least one relay stored it. */
  private async publish(item: string, payload: Payload): Promise<boolean> {
    if (!this.pool || !this.keys || !this.space || !this.secret) return false;
    const d = await this.keys.itemTag(item);
    const createdAt = Math.max(Math.floor(Date.now() / 1000), (this.lastCreatedAt.get(d) ?? 0) + 1);
    this.lastCreatedAt.set(d, createdAt);
    const ev = finalizeEvent(
      {
        kind: KIND,
        created_at: createdAt,
        tags: [
          ['d', d],
          ['w', this.keys.tag],
        ],
        content: await seal(this.keys.aes, payload),
      },
      this.secret,
    );
    try {
      await Promise.any(this.pool.publish(this.space.relays, ev, { maxWait: 8000 }));
      return true;
    } catch (err) {
      this.lastError = `No relay accepted the change. ${relayReasons(err)}`;
      return false;
    }
  }

  // ---------- spaces and pairing ----------

  async createSpace(name: string) {
    const cfg: SpaceConfig = { key: toB64(randomBytes(32)), name: name.trim() || 'My planner', relays: [...DEFAULT_RELAYS], joinedAt: Date.now() };
    await this.host.setSetting('sync', cfg);
    await this.host.setSetting('syncCursor', 0);
    await this.start();
    await this.enqueueAll();
  }

  /** Publish the space key under a one-time code. Valid for 10 minutes. */
  async createInvite(): Promise<{ code: string; expiresAt: number }> {
    if (!this.space || !this.pool) throw new Error('Set up sync first.');
    const code = newPairingCode();
    const { tag, aes } = await derivePairing(code);
    const now = Math.floor(Date.now() / 1000);
    const invite: Invite = { key: this.space.key, name: this.space.name, relays: this.space.relays, from: this.deviceName };
    const ev = finalizeEvent(
      {
        kind: KIND,
        created_at: now,
        tags: [
          ['d', tag],
          ['expiration', String(now + INVITE_TTL_S)],
        ],
        content: await seal(aes, invite),
      },
      generateSecretKey(), // throwaway key: the invite isn't linked to this device
    );
    try {
      await Promise.any(this.pool.publish(pairingRelays(this.space.relays), ev, { maxWait: 8000 }));
    } catch (err) {
      throw new Error(`No relay accepted the code. ${relayReasons(err)} Open Relays → Test relays to see which relays work from here.`);
    }
    return { code, expiresAt: (now + INVITE_TTL_S) * 1000 };
  }

  /** Look up an invite by code. Doesn't change anything yet. */
  async findInvite(input: string): Promise<Invite> {
    const code = normalizeCode(input);
    if (!code) throw new Error('A code has 12 letters and digits, like 7K4M-Q9TX-2HBF.');
    const { tag, aes } = await derivePairing(code);
    const pool = new SimplePool();
    try {
      const events = await pool.querySync(pairingRelays(), { kinds: [KIND], '#d': [tag] }, { maxWait: 8000 });
      const now = Date.now() / 1000;
      const live = events
        .filter((e) => Number(e.tags.find((t) => t[0] === 'expiration')?.[1] ?? Infinity) > now)
        .sort((a, b) => b.created_at - a.created_at);
      for (const ev of live) {
        try {
          const inv = await open<Invite>(aes, ev.content);
          if (inv?.key && Array.isArray(inv.relays)) return inv;
        } catch {
          /* try the next one */
        }
      }
    } finally {
      pool.destroy();
    }
    throw new Error('No invite found for this code. Check the code, and that it was created in the last 10 minutes.');
  }

  /** Join a space. 'merge' keeps this device's tasks and shares them; 'replace' discards them first. */
  async acceptInvite(inv: Invite, mode: 'merge' | 'replace') {
    this.stop();
    if (mode === 'replace') await this.host.clearLocalTasks();
    const cfg: SpaceConfig = { key: inv.key, name: inv.name, relays: inv.relays.length ? inv.relays : DEFAULT_RELAYS, joinedAt: Date.now() };
    await this.host.setSetting('sync', cfg);
    await this.host.setSetting('syncCursor', 0);
    await this.start();
    if (mode === 'merge') await this.enqueueAll();
  }

  async setRelays(relays: string[]) {
    if (!this.space) return;
    const cfg = { ...this.space, relays };
    this.stop();
    await this.host.setSetting('sync', cfg);
    await this.start();
  }

  /** Stop syncing on this device. Tasks stay here; other devices keep the space. */
  async leave() {
    this.stop();
    await this.host.setSetting('sync', null);
    await this.host.setSetting('syncCursor', 0);
    await this.host.db().delete(outbox);
    this.space = null;
    this.devicesMap.clear();
    this.devices = [];
    this.pending = 0;
    this.lastSyncAt = null;
  }
}

/** Summarize why every relay refused, e.g. "relay.primal.net: blocked: kind not allowed". */
function relayReasons(err: unknown): string {
  const errs = (err as AggregateError)?.errors ?? [err];
  const msgs = [...new Set(errs.map((e) => String((e as Error)?.message ?? e).slice(0, 100)))];
  return `Relays said: ${msgs.slice(0, 3).join('; ')}.`;
}

function isTaskShape(t: unknown): t is Task {
  const r = t as Task;
  return !!r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.clocks === 'object' && r.clocks !== null;
}



function safeNormalize(u: string): string {
  try {
    return normalizeURL(u);
  } catch {
    return u;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /Linux/.test(ua)
              ? 'Linux PC'
              : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}
