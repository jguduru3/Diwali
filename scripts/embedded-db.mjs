// Fallback local Postgres 16 for machines without Docker.
// Same credentials and port as docker-compose.yml, data kept in ./.pgdata.
// Usage: pnpm db:embedded   (Ctrl+C to stop)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = resolve(import.meta.dirname, '..', '.pgdata');
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'pataka',
  password: 'pataka',
  port: 5432,
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
console.log('Postgres 16 running on localhost:5432 (db pataka, user pataka). Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
