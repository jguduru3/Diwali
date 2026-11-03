import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Db | undefined;

const poolMax = () => {
  const n = Number(process.env.DB_POOL_MAX ?? 5);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 5;
};

/** Lazily created shared pool; one per Functions worker. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
      // per instance; production sets DB_POOL_MAX with PgBouncer in front (infra/main.bicep)
      max: poolMax(),
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = drizzle(getPool(), { schema });
  return db;
}

/** Closes the pool (tests and scripts). */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Resolves true if the database answers `select 1` within the timeout. */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  try {
    const query = getPool().query('select 1');
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('db ping timeout')), timeoutMs),
    );
    await Promise.race([query, timeout]);
    return true;
  } catch {
    return false;
  }
}
