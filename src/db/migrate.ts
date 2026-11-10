/*
 * Browser-side migrator for drizzle-kit output.
 * `npm run db:generate` writes SQL files to ./drizzle; they are bundled here
 * and applied in order on startup, each inside its own transaction.
 */
import journal from '../../drizzle/meta/_journal.json';

const files = import.meta.glob('../../drizzle/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

type Exec = (sql: string) => Promise<unknown>;
type Select = (sql: string) => Promise<unknown[][]>;

export async function migrate(exec: Exec, select: Select): Promise<string[]> {
  await exec(`CREATE TABLE IF NOT EXISTS __migrations (
    tag TEXT PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  );`);
  const done = new Set((await select('SELECT tag FROM __migrations')).map((r) => String(r[0])));
  const applied: string[] = [];
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    if (done.has(entry.tag)) continue;
    const sql = files[`../../drizzle/${entry.tag}.sql`];
    if (sql === undefined) throw new Error(`Migration file missing for ${entry.tag}`);
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.endsWith(';') ? s : s + ';'));
    const tag = entry.tag.replace(/'/g, "''");
    await exec(
      `BEGIN;\n${statements.join('\n')}\nINSERT INTO __migrations (tag, applied_at) VALUES ('${tag}', ${Date.now()});\nCOMMIT;`,
    );
    applied.push(entry.tag);
  }
  return applied;
}
