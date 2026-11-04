import { getDb, closeDb } from '../src/db/client';
import { items } from '../src/db/schema';
import { sql } from 'drizzle-orm';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
const db = getDb();
await db.update(items).set({ isStandard: false });
await db.execute(sql`DELETE FROM items WHERE item_no > 18`);
await db.execute(sql`UPDATE shop_price_versions SET version = version + 1`);
await closeDb();
console.log('Done reset.');
