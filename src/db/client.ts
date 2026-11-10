import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';
import type { OpenResult, Query, Request, Response } from './protocol';
import { migrate } from './migrate';

/** Promise-based RPC to the SQLite worker. */
class WorkerConnection {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Response>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
  }

  call<T>(req: Request): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, ...req });
    });
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Database closed'));
    this.pending.clear();
  }
}

function makeDrizzle(conn: WorkerConnection) {
  return drizzle(
    async (sql, params, method) => {
      const rows = await conn.call<unknown>({ op: 'query', query: { sql, params, method } satisfies Query });
      return { rows: rows as never };
    },
    async (queries) => {
      const results = await conn.call<unknown[]>({
        op: 'batch',
        queries: queries.map((q) => ({ sql: q.sql, params: q.params, method: q.method })),
      });
      return results.map((rows) => ({ rows: rows as never }));
    },
    { schema },
  );
}

export type Db = ReturnType<typeof makeDrizzle>;

export interface Database {
  db: Db;
  info: OpenResult;
  exportFile(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export async function openDatabase(): Promise<Database> {
  const conn = new WorkerConnection();
  const info = await conn.call<OpenResult>({ op: 'open' });
  await migrate((sql) => conn.call({ op: 'script', sql }), (sql) =>
    conn.call<unknown[][]>({ op: 'query', query: { sql, params: [], method: 'all' } }),
  );
  return {
    db: makeDrizzle(conn),
    info,
    exportFile: () => conn.call<Uint8Array>({ op: 'export' }),
    async close() {
      try {
        await conn.call({ op: 'close' });
      } finally {
        conn.terminate();
      }
    },
  };
}
