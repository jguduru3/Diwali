// Applies SQL migrations from src/db/migrations. Uses DATABASE_URL.
import { fileURLToPath } from 'node:url';
import { closeDb, getPool } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
try {
  await runMigrations(
    getPool(),
    fileURLToPath(new URL('../src/db/migrations', import.meta.url)),
    console.log,
  );
} catch (err) {
  const url = process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, '//***@') ?? '(unset)';
  console.error(`Could not apply migrations to ${url}.`);
  console.error(
    'Is the database running? Locally: `pnpm db:embedded` (port 5433) or `docker compose up -d`.',
  );
  throw err;
}
await closeDb();
console.log('Migrations applied.');
