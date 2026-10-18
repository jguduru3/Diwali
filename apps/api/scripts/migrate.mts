// Applies SQL migrations from src/db/migrations. Uses DATABASE_URL.
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../src/db/client';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
await migrate(getDb(), {
  migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)),
});
await closeDb();
console.log('Migrations applied.');
