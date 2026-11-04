import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

type Tx = Pick<Db, 'insert'>;

export async function audit(
  db: Tx,
  entry: {
    actorUserId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    meta: entry.meta ?? null,
  });
}
