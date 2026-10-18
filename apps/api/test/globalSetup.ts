// Integration DB: TEST_DATABASE_URL if set (CI service container), otherwise a
// throwaway embedded Postgres 16 in a temp dir. Migrations run once per test run.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;

  if (!url) {
    const dir = mkdtempSync(join(tmpdir(), 'pataka-pg-'));
    const port = 54329;
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'test',
      password: 'test',
      port,
      persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('pataka_test');
    url = `postgres://test:test@localhost:${port}/pataka_test`;
    stop = async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)),
  });
  await pool.end();

  project.provide('databaseUrl', url);
  return async () => {
    await stop?.();
  };
}
