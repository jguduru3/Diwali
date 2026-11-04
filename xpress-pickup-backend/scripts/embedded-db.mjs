// Fallback local Postgres 16 for machines without Docker.
// Same credentials and port as docker-compose.yml, data kept in ./.pgdata.
// Port 5433 (not 5432) so a system PostgreSQL install never collides with it.
// Usage: pnpm db:embedded   (Ctrl+C to stop)
// Port: PGPORT, else the one in apps/api/local.settings.json DATABASE_URL, else 5432.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = resolve(import.meta.dirname, '..', '.pgdata');

function settingsPort() {
  const file = resolve(import.meta.dirname, '..', 'apps', 'api', 'local.settings.json');
  if (!existsSync(file)) return undefined;
  try {
    const url = JSON.parse(readFileSync(file, 'utf8')).Values?.DATABASE_URL;
    return url ? new URL(url).port || undefined : undefined;
  } catch {
    return undefined;
  }
}

const port = Number(process.env.PGPORT ?? settingsPort() ?? 5432);
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'pataka',
  password: 'pataka',
  port,
  persistent: true,
  // UTF-8 regardless of the OS code page, so Telugu names store correctly.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!existsSync(databaseDir)) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase('pataka');
} catch {
  // already exists
}
console.log(`Postgres 16 running on localhost:${port} (db pataka, user pataka). Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
