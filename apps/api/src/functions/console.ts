// Admin console. Routes live under /api/console because the Functions host
// reserves /api/admin for itself.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import {
  addDays,
  categoryInputSchema,
  categoryPatchSchema,
  clusterInputSchema,
  clusterPatchSchema,
  dateSchema,
  effectivePassStatus,
  formatPassRef,
  istDate,
  istDayRange,
  licenceDecisionSchema,
  licenceStatusSchema,
  normalizeIndianPhone,
  passActionSchema,
  passHolderMask,
  passStatusSchema,
  shopInputSchema,
  shopPatchSchema,
  type AdminCluster,
  type AdminPass,
  type AdminShop,
  type BlockedUser,
  type FlaggedScan,
  type Metrics,
  type MetricsRow,
} from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import {
  categories,
  clusters,
  items,
  passes,
  passScans,
  payments,
  refunds,
  shopLicences,
  shopPriceVersions,
  shops,
  users,
  visibleShops,
} from '../db/schema';
import { requireUuidParam } from '../lib/access';
import { audit } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { categoryView } from '../lib/catalogue';
import { HttpError } from '../lib/errors';
import { http, json, parseBody, parseQuery } from '../lib/http';
import { refundPass, revokePass } from '../lib/passes';
import { activeProvider } from '../lib/payments';
import { mockId, mockProvider, signMockEvent } from '../lib/payments/mock';
import { clusterView } from '../lib/places';
import { licenceView } from '../lib/reports';
import { fileStore } from '../lib/storage';
import { processWebhook } from './payments';

const admin = (db: Db, req: HttpRequest) => requireRole(db, req, ['admin']);

// ---- Clusters ----

async function listClusters(db: Db): Promise<AdminCluster[]> {
  const rows = await db
    .select({
      c: clusters,
      shopCount: sql<number>`(select count(*)::int from shops s where s.cluster_id = ${clusters.id})`,
    })
    .from(clusters)
    .orderBy(asc(clusters.name));
  return rows.map(({ c, shopCount }) => ({
    ...clusterView(c)!,
    isActive: c.isActive,
    shopCount,
  }));
}

export async function clustersListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  return json(await listClusters(db));
}

export async function clusterCreateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const input = await parseBody(req, clusterInputSchema);
  const [row] = await db.insert(clusters).values(input).returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'cluster.create',
    entity: 'cluster',
    entityId: row!.id,
  });
  return json(
    (await listClusters(db)).find((c) => c.id === row!.id),
    201,
  );
}

export async function clusterPatchHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const patch = await parseBody(req, clusterPatchSchema);
  const [row] = await db.update(clusters).set(patch).where(eq(clusters.id, id)).returning();
  if (!row) throw new HttpError(404, 'cluster_not_found', 'No such cluster');
  await audit(db, {
    actorUserId: user.id,
    action: 'cluster.update',
    entity: 'cluster',
    entityId: id,
    meta: patch,
  });
  return json((await listClusters(db)).find((c) => c.id === id));
}

// ---- Shops ----

async function listShops(db: Db, onlyId?: string): Promise<AdminShop[]> {
  const rows = await db
    .select({
      s: shops,
      clusterName: clusters.name,
      visible: sql<boolean>`exists (select 1 from visible_shops v where v.id = ${shops.id})`,
      itemCount: sql<number>`(select count(*)::int from items i where i.shop_id = ${shops.id} and i.is_active)`,
    })
    .from(shops)
    .leftJoin(clusters, eq(clusters.id, shops.clusterId))
    .where(onlyId ? eq(shops.id, onlyId) : undefined)
    .orderBy(asc(shops.shortCode));
  const licences = rows.length
    ? await db
        .select()
        .from(shopLicences)
        .where(
          inArray(
            shopLicences.shopId,
            rows.map((r) => r.s.id),
          ),
        )
        .orderBy(desc(shopLicences.createdAt))
    : [];
  return rows.map(({ s, clusterName, visible, itemCount }) => {
    const mine = licences.filter((l) => l.shopId === s.id);
    const best = mine.find((l) => l.status === 'verified') ?? mine[0];
    return {
      id: s.id,
      shortCode: s.shortCode,
      name: s.name,
      area: s.area,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      phone: s.phoneE164,
      clusterId: s.clusterId,
      clusterName,
      openFrom: s.openFrom?.slice(0, 5) ?? null,
      openTo: s.openTo?.slice(0, 5) ?? null,
      isLive: s.isLive,
      visible,
      licenceStatus: best?.status ?? null,
      licenceValidFrom: best?.validFrom ?? null,
      licenceValidTo: best?.validTo ?? null,
      itemCount,
    };
  });
}

export async function shopsListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  return json(await listShops(db));
}

export async function shopCreateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const { phone, ...input } = await parseBody(req, shopInputSchema);
  const row = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(shops)
      .values({
        ...input,
        phoneE164: phone ?? null,
        openFrom: input.openFrom ?? '10:00',
        openTo: input.openTo ?? '22:00',
      })
      .returning();
    await tx.insert(shopPriceVersions).values({ shopId: s!.id, version: 1 });
    await audit(tx, {
      actorUserId: user.id,
      action: 'shop.create',
      entity: 'shop',
      entityId: s!.id,
    });
    return s!;
  });
  return json((await listShops(db, row.id))[0], 201);
}

export async function shopPatchHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const { phone, ...patch } = await parseBody(req, shopPatchSchema);
  const [row] = await db
    .update(shops)
    .set({ ...patch, ...(phone !== undefined ? { phoneE164: phone } : {}) })
    .where(eq(shops.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'shop_not_found', 'No such shop');
  await audit(db, {
    actorUserId: user.id,
    action: 'shop.update',
    entity: 'shop',
    entityId: id,
    meta: patch,
  });
  return json((await listShops(db, id))[0]);
}

// ---- Categories ----

export async function categoriesListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.sort), asc(categories.nameEn));
  return json(rows.map(categoryView));
}

export async function categoryCreateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const input = await parseBody(req, categoryInputSchema);
  const [row] = await db.insert(categories).values(input).returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'category.create',
    entity: 'category',
    entityId: row!.id,
  });
  return json(categoryView(row!), 201);
}

/** Banning a category also takes its items off every price list (G7). */
export async function categoryPatchHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const patch = await parseBody(req, categoryPatchSchema);
  const row = await db.transaction(async (tx) => {
    const [c] = await tx.update(categories).set(patch).where(eq(categories.id, id)).returning();
    if (!c) throw new HttpError(404, 'category_not_found', 'No such category');
    if (patch.isBanned) {
      const hit = await tx
        .update(items)
        .set({ isActive: false })
        .where(and(eq(items.categoryId, id), eq(items.isActive, true)))
        .returning({ shopId: items.shopId });
      for (const shopId of new Set(hit.map((h) => h.shopId))) {
        await tx
          .update(shopPriceVersions)
          .set({ version: sql`${shopPriceVersions.version} + 1` })
          .where(eq(shopPriceVersions.shopId, shopId));
      }
    }
    await audit(tx, {
      actorUserId: user.id,
      action: 'category.update',
      entity: 'category',
      entityId: id,
      meta: patch,
    });
    return c;
  });
  return json(categoryView(row));
}

// ---- Licences ----

export async function licencesListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const status = req.query.get('status');
  const filter = status ? licenceStatusSchema.parse(status) : null;
  const rows = await db
    .select({ l: shopLicences, shop: shops })
    .from(shopLicences)
    .innerJoin(shops, eq(shops.id, shopLicences.shopId))
    .where(filter ? eq(shopLicences.status, filter) : undefined)
    .orderBy(desc(shopLicences.createdAt));
  return json(rows.map((r) => licenceView(r.l, r.shop)));
}

/** GET /api/console/licences/{id}/image — the private photo, admins only. */
export async function licenceImageHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const [l] = await db.select().from(shopLicences).where(eq(shopLicences.id, id));
  if (!l) throw new HttpError(404, 'licence_not_found', 'No such licence');
  const file = await fileStore().get(l.imageBlobPath);
  if (!file) throw new HttpError(404, 'image_missing', 'Licence photo not found');
  return {
    status: 200,
    body: file.data,
    headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store' },
  };
}

async function decideLicence(req: HttpRequest, status: 'verified' | 'rejected') {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const { notes } = await parseBody(req, licenceDecisionSchema);
  const out = await db.transaction(async (tx) => {
    const [l] = await tx
      .update(shopLicences)
      .set({ status, notes: notes ?? null, verifiedBy: user.id, verifiedAt: sql`now()` })
      .where(eq(shopLicences.id, id))
      .returning();
    if (!l) throw new HttpError(404, 'licence_not_found', 'No such licence');
    // Verifying approves the shop for listing; it shows once the licence is in date.
    if (status === 'verified')
      await tx.update(shops).set({ isLive: true }).where(eq(shops.id, l.shopId));
    await audit(tx, {
      actorUserId: user.id,
      action: `licence.${status}`,
      entity: 'licence',
      entityId: id,
    });
    const [shop] = await tx.select().from(shops).where(eq(shops.id, l.shopId));
    return licenceView(l, shop!);
  });
  return json(out);
}

export const licenceVerifyHandler = (req: HttpRequest) => decideLicence(req, 'verified');
export const licenceRejectHandler = (req: HttpRequest) => decideLicence(req, 'rejected');

// ---- Blocked numbers ----

export async function blockedUsersHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const rows = await db
    .select()
    .from(users)
    .where(and(isNotNull(users.blockedUntil), gt(users.blockedUntil, sql`now()`)))
    .orderBy(desc(users.blockedUntil));
  const body: BlockedUser[] = rows.map((u) => ({
    userId: u.id,
    phone: u.phoneE164,
    blockedUntil: u.blockedUntil?.toISOString() ?? null,
  }));
  return json(body);
}

export async function unblockHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const [row] = await db
    .update(users)
    .set({ blockedUntil: null })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw new HttpError(404, 'user_not_found', 'No such user');
  await audit(db, { actorUserId: user.id, action: 'user.unblock', entity: 'user', entityId: id });
  return json({ ok: true });
}

// ---- Express Passes ----

async function adminPassRows(db: Db, where: SQL | undefined, limit = 100): Promise<AdminPass[]> {
  const rows = await db
    .select({
      p: passes,
      phone: users.phoneE164,
      scans: sql<number>`(select count(*)::int from pass_scans s where s.pass_id = ${passes.id})`,
      flagged: sql<number>`(select count(*)::int from pass_scans s where s.pass_id = ${passes.id} and s.flag is not null)`,
    })
    .from(passes)
    .innerJoin(users, eq(users.id, passes.userId))
    .where(where)
    .orderBy(desc(passes.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);
  const pays = await db
    .select()
    .from(payments)
    .where(inArray(payments.passId, ids))
    .orderBy(desc(payments.createdAt));
  const refs = pays.length
    ? await db
        .select()
        .from(refunds)
        .where(
          inArray(
            refunds.paymentId,
            pays.map((p) => p.id),
          ),
        )
        .orderBy(desc(refunds.createdAt))
    : [];
  return rows.map(({ p, phone, scans, flagged }) => {
    const mine = pays.filter((x) => x.passId === p.id);
    const pay = mine.find((x) => x.status === 'captured') ?? mine[0];
    const refund = pay ? refs.find((r) => r.paymentId === pay.id) : undefined;
    return {
      id: p.id,
      ref: formatPassRef(p.ref),
      status: effectivePassStatus(p),
      maskedPhone: passHolderMask(phone),
      feePaise: p.feePaise,
      validTo: p.validTo?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
      scans,
      flaggedScans: flagged,
      payment: pay
        ? { provider: pay.provider, providerPaymentId: pay.providerPaymentId, status: pay.status }
        : null,
      refund: refund ? { status: refund.status, amountPaise: refund.amountPaise } : null,
    };
  });
}

/** GET /api/console/passes?q=&status= — q is a pass reference or a full phone number. */
export async function passesListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const q = req.query.get('q')?.trim() ?? '';
  const status = req.query.get('status');
  const filters: SQL[] = [];
  if (q) {
    const ref = q.toUpperCase().replace(/^DXP-?/, '').replace(/[\s-]/g, '');
    const phone = normalizeIndianPhone(q);
    filters.push(phone ? eq(users.phoneE164, phone) : eq(passes.ref, ref));
  }
  if (status) {
    const s = passStatusSchema.parse(status);
    if (s === 'expired') filters.push(eq(passes.status, 'active'), lt(passes.validTo, sql`now()`));
    else if (s === 'active') {
      filters.push(eq(passes.status, 'active'), gt(passes.validTo, sql`now()`));
    } else filters.push(eq(passes.status, s));
  }
  return json(await adminPassRows(db, filters.length ? and(...filters) : undefined));
}

/** POST /api/console/passes/{id}/revoke {reason} — stops verification at once. */
export async function passRevokeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const { reason } = await parseBody(req, passActionSchema);
  await revokePass(db, id, user.id, reason);
  return json((await adminPassRows(db, eq(passes.id, id)))[0]);
}

/** POST /api/console/passes/{id}/refund {reason} — full refund of the pass fee. */
export async function passRefundHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await admin(db, req);
  const id = requireUuidParam(req, 'id');
  const { reason } = await parseBody(req, passActionSchema);
  const provider = activeProvider();
  const refund = await refundPass(db, id, user.id, reason, provider);
  // The mock provider settles refunds at once through the signed webhook path.
  if (provider.name === mockProvider.name) {
    const signed = signMockEvent({
      id: mockId('mock_ev'),
      type: 'refund.processed',
      refundId: refund.providerRefundId,
      paymentId: refund.providerPaymentId,
      amountPaise: refund.amountPaise,
    });
    await processWebhook(db, provider.name, signed.rawBody, signed.headers);
  }
  return json((await adminPassRows(db, eq(passes.id, id)))[0]);
}

/** GET /api/console/scans/flagged — flagged checks in the last 7 days. */
export async function flaggedScansHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const rows = await db
    .select({ s: passScans, ref: passes.ref, shopName: shops.name, clusterName: clusters.name })
    .from(passScans)
    .leftJoin(passes, eq(passes.id, passScans.passId))
    .leftJoin(shops, eq(shops.id, passScans.shopId))
    .leftJoin(clusters, eq(clusters.id, passScans.clusterId))
    .where(and(isNotNull(passScans.flag), gt(passScans.at, sql`now() - interval '7 days'`)))
    .orderBy(desc(passScans.at))
    .limit(200);
  const body: FlaggedScan[] = rows.map((r) => ({
    id: r.s.id,
    at: r.s.at.toISOString(),
    result: r.s.result,
    flag: r.s.flag,
    passRef: r.ref ? formatPassRef(r.ref) : null,
    passId: r.s.passId,
    place: r.shopName ?? r.clusterName ?? '—',
  }));
  return json(body);
}

// ---- Metrics ----

/**
 * GET /api/console/metrics?from=&to= — passes issued, pass fees and refunds
 * (platform fees only, never sale amounts — G4), checks and participating shops.
 */
export async function metricsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const to = parseQuery(req.query.get('to') ?? istDate(), dateSchema);
  const from = parseQuery(req.query.get('from') ?? addDays(istDate(), -14), dateSchema);
  const range = { from: istDayRange(from).from, to: istDayRange(to).to };
  const day = (col: SQL | AnyColumn) =>
    sql<string>`to_char((${col} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`;

  const issued = await db
    .select({
      day: day(payments.capturedAt),
      n: sql<number>`count(*)::int`,
      paise: sql<number>`coalesce(sum(${payments.amountPaise}), 0)::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'captured'),
        gte(payments.capturedAt, range.from),
        lt(payments.capturedAt, range.to),
      ),
    )
    .groupBy(sql`1`);
  const refunded = await db
    .select({
      day: day(refunds.processedAt),
      paise: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int`,
    })
    .from(refunds)
    .where(
      and(
        eq(refunds.status, 'processed'),
        gte(refunds.processedAt, range.from),
        lt(refunds.processedAt, range.to),
      ),
    )
    .groupBy(sql`1`);
  const checks = await db
    .select({
      day: day(passScans.at),
      n: sql<number>`count(*) filter (where ${passScans.result} = 'valid')::int`,
      flagged: sql<number>`count(*) filter (where ${passScans.flag} is not null)::int`,
      shops: sql<number>`count(distinct ${passScans.shopId})::int`,
    })
    .from(passScans)
    .where(and(gte(passScans.at, range.from), lt(passScans.at, range.to)))
    .groupBy(sql`1`);

  const days = new Set([...issued, ...refunded, ...checks].map((r) => r.day));
  const rows: MetricsRow[] = [...days].sort().map((d) => {
    const i = issued.find((r) => r.day === d);
    const c = checks.find((r) => r.day === d);
    return {
      day: d,
      passesIssued: i?.n ?? 0,
      feesPaise: i?.paise ?? 0,
      refundsPaise: refunded.find((r) => r.day === d)?.paise ?? 0,
      scans: c?.n ?? 0,
      flagged: c?.flagged ?? 0,
      shopsScanning: c?.shops ?? 0,
    };
  });
  const sum = (k: keyof MetricsRow) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const [{ active } = { active: 0 }] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(passes)
    .where(and(eq(passes.status, 'active'), gt(passes.validTo, sql`now()`)));
  const [{ visible } = { visible: 0 }] = await db
    .select({ visible: sql<number>`count(*)::int` })
    .from(visibleShops);
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(shops);
  const body: Metrics = {
    from,
    to,
    visibleShops: visible,
    totalShops: total,
    totals: {
      activePasses: active,
      passesIssued: sum('passesIssued'),
      feesPaise: sum('feesPaise'),
      refundsPaise: sum('refundsPaise'),
      netPaise: sum('feesPaise') - sum('refundsPaise'),
      scans: sum('scans'),
      flagged: sum('flagged'),
    },
    rows,
  };
  return json(body);
}

http('consoleClusters', ['GET'], 'console/clusters', clustersListHandler);
http('consoleClusterCreate', ['POST'], 'console/clusters/new', clusterCreateHandler);
http('consoleClusterPatch', ['PATCH'], 'console/clusters/{id}', clusterPatchHandler);
http('consoleShops', ['GET'], 'console/shops', shopsListHandler);
http('consoleShopCreate', ['POST'], 'console/shops/new', shopCreateHandler);
http('consoleShopPatch', ['PATCH'], 'console/shops/{id}', shopPatchHandler);
http('consoleCategories', ['GET'], 'console/categories', categoriesListHandler);
http('consoleCategoryCreate', ['POST'], 'console/categories/new', categoryCreateHandler);
http('consoleCategoryPatch', ['PATCH'], 'console/categories/{id}', categoryPatchHandler);
http('consoleLicences', ['GET'], 'console/licences', licencesListHandler);
http('consoleLicenceImage', ['GET'], 'console/licences/{id}/image', licenceImageHandler);
http('consoleLicenceVerify', ['POST'], 'console/licences/{id}/verify', licenceVerifyHandler);
http('consoleLicenceReject', ['POST'], 'console/licences/{id}/reject', licenceRejectHandler);
http('consoleBlocked', ['GET'], 'console/users/blocked', blockedUsersHandler);
http('consoleUnblock', ['POST'], 'console/users/{id}/unblock', unblockHandler);
http('consoleMetrics', ['GET'], 'console/metrics', metricsHandler);
http('consolePasses', ['GET'], 'console/passes', passesListHandler);
http('consolePassRevoke', ['POST'], 'console/passes/{id}/revoke', passRevokeHandler);
http('consolePassRefund', ['POST'], 'console/passes/{id}/refund', passRefundHandler);
http('consoleFlaggedScans', ['GET'], 'console/scans/flagged', flaggedScansHandler);
