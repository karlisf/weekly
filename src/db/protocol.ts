export type QueryMethod = 'run' | 'all' | 'values' | 'get';

export interface Query {
  sql: string;
  params: unknown[];
  method: QueryMethod;
}

export type Request =
  | { op: 'open' }
  | { op: 'query'; query: Query }
  | { op: 'batch'; queries: Query[] }
  | { op: 'script'; sql: string }
  | { op: 'export' }
  | { op: 'close' };

export interface OpenResult {
  /** True when data is stored in the Origin Private File System and survives reloads. */
  persistent: boolean;
  reason?: string;
}

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
