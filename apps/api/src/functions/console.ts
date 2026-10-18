// Admin console. Routes live under /api/console because the Functions host
// reserves /api/admin for itself.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  addDays,
  categoryInputSchema,
  categoryPatchSchema,
  clusterInputSchema,
  clusterPatchSchema,
  dateSchema,
  istDate,
  licenceDecisionSchema,
  licenceStatusSchema,
  shopInputSchema,
  shopPatchSchema,
  type AdminCluster,
  type AdminShop,
  type BlockedUser,
  type MetricsRow,
} from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import {
  categories,
  clusters,
  items,
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
import { fileStore } from '../lib/storage';
import { clusterView } from '../lib/visits';
import { footfall, licenceView } from '../lib/reports';

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
    bayCount: c.bayCount,
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
      defaultCapacityPerSlot: s.defaultCapacityPerSlot,
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
    .orderBy(desc(users.noShowStrikes));
  const body: BlockedUser[] = rows.map((u) => ({
    userId: u.id,
    phone: u.phoneE164,
    noShowStrikes: u.noShowStrikes,
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
    .set({ blockedUntil: null, noShowStrikes: 0 })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw new HttpError(404, 'user_not_found', 'No such user');
  await audit(db, { actorUserId: user.id, action: 'user.unblock', entity: 'user', entityId: id });
  return json({ ok: true });
}

// ---- Metrics ----

/** GET /api/console/metrics?from=&to= — per shop/day footfall, no-show rate, arrive→serve median. */
export async function metricsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  await admin(db, req);
  const to = parseQuery(req.query.get('to') ?? addDays(istDate(), 7), dateSchema);
  const from = parseQuery(req.query.get('from') ?? addDays(istDate(), -7), dateSchema);
  const allShops = await db
    .select({ id: shops.id, code: shops.shortCode, name: shops.name })
    .from(shops);
  const rows = await footfall(
    db,
    allShops.map((s) => s.id),
    from,
    to,
  );
  const body: MetricsRow[] = rows.map((r) => {
    const s = allShops.find((x) => x.id === r.shopId)!;
    const closed = r.served + r.noShow;
    return {
      shopCode: s.code,
      shopName: s.name,
      day: r.day,
      booked: r.booked,
      arrived: r.arrived,
      served: r.served,
      noShow: r.noShow,
      cancelled: r.cancelled,
      noShowRate: closed ? Math.round((r.noShow / closed) * 1000) / 10 : null,
      medianArriveToServeMin: r.medianArriveToServeMin,
    };
  });
  const [{ visible } = { visible: 0 }] = await db
    .select({ visible: sql<number>`count(*)::int` })
    .from(visibleShops);
  return json({ from, to, visibleShops: visible, totalShops: allShops.length, rows: body });
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
