/// <reference lib="webworker" />
/*
 * SQLite runs here, off the main thread. Storage is the OPFS "SAH pool" VFS,
 * which needs no COOP/COEP headers, so the app works on static hosts such as
 * GitHub Pages. Without OPFS we fall back to an in-memory database.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Query, Request, Response, OpenResult } from './protocol';

const DB_FILE = '/weekly.sqlite3';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type DB = InstanceType<Sqlite3['oo1']['DB']>;

let sqlite3: Sqlite3 | undefined;
let db: DB | undefined;

async function open(): Promise<OpenResult> {
  sqlite3 ??= await sqlite3InitModule();
  let result: OpenResult;
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'weekly-sahpool', directory: '.weekly' });
    db = new pool.OpfsSAHPoolDb(DB_FILE);
    result = { persistent: true };
  } catch (err) {
    db = new sqlite3.oo1.DB(':memory:', 'c');
    result = { persistent: false, reason: String((err as Error)?.message ?? err) };
  }
  db.exec('PRAGMA foreign_keys = ON;');
  return result;
}

function run(q: Query): unknown {
  if (!db) throw new Error('Database is not open');
  const rows = db.exec({
    sql: q.sql,
    bind: q.params.length ? (q.params as never) : undefined,
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown[][];
  if (q.method === 'get') return rows[0];
  if (q.method === 'run') return [];
  return rows;
}

function handle(req: Request): unknown {
  switch (req.op) {
    case 'query':
      return run(req.query);
    case 'batch': {
      db!.exec('BEGIN');
      try {
        const out = req.queries.map(run);
        db!.exec('COMMIT');
        return out;
      } catch (e) {
        db!.exec('ROLLBACK');
        throw e;
      }
    }
    case 'script':
      try {
        db!.exec(req.sql);
      } catch (e) {
        // A failed migration script must not leave a transaction open.
        if (sqlite3!.capi.sqlite3_get_autocommit(db!.pointer!) === 0) db!.exec('ROLLBACK');
        throw e;
      }
      return null;
    case 'export':
      return sqlite3!.capi.sqlite3_js_db_export(db!);
    case 'close':
      db?.close();
      db = undefined;
      return null;
    default:
      throw new Error(`Unknown op ${(req as { op: string }).op}`);
  }
}

self.onmessage = async (ev: MessageEvent<{ id: number } & Request>) => {
  const { id, ...req } = ev.data;
  let res: Response;
  try {
    const result = req.op === 'open' ? await open() : handle(req as Request);
    res = { id, ok: true, result };
  } catch (err) {
    res = { id, ok: false, error: String((err as Error)?.message ?? err) };
  }
  (self as unknown as Worker).postMessage(res);
};
