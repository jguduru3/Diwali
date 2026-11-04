// Runs the SQL migrations in src/db/migrations, including any Drizzle would silently skip.
//
// Drizzle's migrator only applies journal entries newer than the last one recorded in the
// database. When two branches each add a migration and one is renumbered on merge, a database
// that already ran the other branch's migration has a *later* timestamp recorded, so the
// renumbered one is never applied and queries fail on missing columns. Before handing over to
// Drizzle we apply every journal entry whose content hash isn't recorded and whose timestamp is
// at or before the last recorded one, each in its own transaction, and record it the way
// Drizzle does (sha256 of the file, `when` as created_at).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

export type JournalEntry = { idx: number; when: number; tag: string };
export type Migration = JournalEntry & { hash: string; sql: string };
export type RecordedMigration = { hash: string; createdAt: number };

export function readMigrations(folder: string): Migration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return journal.entries.map((e) => {
    const sql = readFileSync(join(folder, `${e.tag}.sql`), 'utf8');
    return { ...e, sql, hash: createHash('sha256').update(sql).digest('hex') };
  });
}

/** Journal entries Drizzle will never apply: not recorded, and not newer than the last record. */
export function skippedMigrations(all: Migration[], recorded: RecordedMigration[]): Migration[] {
  if (recorded.length === 0) return [];
  const last = Math.max(...recorded.map((r) => r.createdAt));
  const done = new Set(recorded.map((r) => r.hash));
  return all.filter((m) => !done.has(m.hash) && m.when <= last);
}

export async function runMigrations(
  pool: Pool,
  folder: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  const { rows: exists } = await pool.query<{ ok: boolean }>(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as ok`,
  );
  if (exists[0]?.ok) {
    const { rows } = await pool.query<{ hash: string; created_at: string }>(
      'select hash, created_at from drizzle.__drizzle_migrations',
    );
    const recorded = rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
    for (const m of skippedMigrations(readMigrations(folder), recorded)) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const stmt of m.sql.split('--> statement-breakpoint')) {
          if (stmt.trim()) await client.query(stmt);
        }
        await client.query(
          'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
          [m.hash, m.when],
        );
        await client.query('commit');
        log(`Applied ${m.tag} (skipped earlier because of migration numbering).`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Could not apply ${m.tag}: ${(err as Error).message}`, { cause: err });
      } finally {
        client.release();
      }
    }
  }
  await migrate(drizzle(pool), { migrationsFolder: folder });
}
