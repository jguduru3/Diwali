// Bootstrap the first admin in any environment:
//   DATABASE_URL=... pnpm --filter api admin:grant +91XXXXXXXXXX
import { sql } from 'drizzle-orm';
import { normalizeIndianPhone } from '@pataka/shared';
import { closeDb, getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { audit } from '../src/lib/audit';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
const phone = normalizeIndianPhone(process.argv[2] ?? '');
if (!phone) {
  console.error('Usage: pnpm --filter api admin:grant <indian mobile number>');
  process.exit(1);
}

const db = getDb();
const [user] = await db
  .insert(users)
  .values({ phoneE164: phone, role: 'admin' })
  .onConflictDoUpdate({
    target: users.phoneE164,
    set: { role: 'admin', tokenVersion: sql`${users.tokenVersion} + 1` },
  })
  .returning();
await audit(db, {
  actorUserId: null,
  action: 'cli.grant_admin',
  entity: 'user',
  entityId: user!.id,
});
await closeDb();
console.log(`${phone} is now an admin.`);
