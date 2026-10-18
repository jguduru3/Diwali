// Gate app (ground marshal): scan a customer's Express Pass at the ground
// entrance. Same check as the shop counter; the pass is never consumed.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import {
  formatPassRef,
  istDate,
  istDayRange,
  verifyPassSchema,
  type GateToday,
  type ScanRow,
} from '@pataka/shared';
import { getDb } from '../db/client';
import { passes, passScans } from '../db/schema';
import { requireCluster } from '../lib/access';
import { http, json, parseBody } from '../lib/http';
import { verifyPass } from '../lib/passes';
import { clusterView } from '../lib/places';
import { rateLimit } from '../lib/rateLimit';

/** POST /api/gate/passes/verify {qr} */
export async function gateVerifyHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, cluster } = await requireCluster(db, req);
  const { qr } = await parseBody(req, verifyPassSchema);
  await rateLimit(db, `verify:${user.id}`, 120, 60);
  return json(await verifyPass(db, qr, { clusterId: cluster.id }, user.id));
}

/** GET /api/gate/today — today's scans at this ground. */
export async function gateTodayHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { cluster } = await requireCluster(db, req);
  const { from, to } = istDayRange(istDate());
  const rows = await db
    .select({ s: passScans, ref: passes.ref })
    .from(passScans)
    .leftJoin(passes, eq(passes.id, passScans.passId))
    .where(and(eq(passScans.clusterId, cluster.id), gte(passScans.at, from), lt(passScans.at, to)))
    .orderBy(desc(passScans.at))
    .limit(300);
  const scans: ScanRow[] = rows.map((r) => ({
    id: r.s.id,
    at: r.s.at.toISOString(),
    result: r.s.result,
    flag: r.s.flag,
    passRef: r.ref ? formatPassRef(r.ref) : null,
    place: cluster.name,
  }));
  const body: GateToday = {
    cluster: clusterView(cluster)!,
    scans,
    counts: {
      valid: scans.filter((s) => s.result === 'valid').length,
      flagged: scans.filter((s) => s.flag).length,
      refused: scans.filter((s) => s.result !== 'valid').length,
    },
  };
  return json(body);
}

http('gateVerify', ['POST'], 'gate/passes/verify', gateVerifyHandler);
http('gateToday', ['GET'], 'gate/today', gateTodayHandler);
