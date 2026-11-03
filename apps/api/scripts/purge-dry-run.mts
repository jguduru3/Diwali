// Shows what the purge job would delete right now (or at --at=YYYY-MM-DD), without deleting.
//   pnpm --filter api purge:dry-run [--at=2027-02-20]
import { istInstant } from '@pataka/shared';
import { closeDb, getDb } from '../src/db/client';
import { purge } from '../src/lib/jobs';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
const at = process.argv.find((a) => a.startsWith('--at='))?.slice(5);
const now = at ? istInstant(at, '03:00') : new Date();
console.log(JSON.stringify(await purge(getDb(), now, true), null, 2));
await closeDb();
