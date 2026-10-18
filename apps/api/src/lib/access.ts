import type { HttpRequest } from '@azure/functions';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { clusterMarshals, clusters, shopMembers, shops } from '../db/schema';
import { requireRole, type SessionUser } from './auth';
import { forbidden, HttpError } from './errors';

export type ShopRow = typeof shops.$inferSelect;
export type ClusterRow = typeof clusters.$inferSelect;
export type ShopAccess = { user: SessionUser; shop: ShopRow; isOwner: boolean };

/**
 * Row-level authorisation for the shop app (SPEC §10). Vendors act on their own
 * shop; admins pick one with ?shop=CODE. `ownerOnly` excludes counter staff.
 */
export async function requireShop(
  db: Db,
  req: HttpRequest,
  opts: { ownerOnly?: boolean } = {},
): Promise<ShopAccess> {
  const user = await requireRole(db, req, ['shop_owner', 'shop_staff', 'admin']);
  const wanted = req.query.get('shop')?.trim().toUpperCase() || null;

  if (user.role === 'admin') {
    const [shop] = wanted
      ? await db.select().from(shops).where(eq(shops.shortCode, wanted))
      : await db.select().from(shops).orderBy(asc(shops.shortCode)).limit(1);
    if (!shop) throw new HttpError(404, 'shop_not_found', 'No shop with that code');
    return { user, shop, isOwner: true };
  }

  const rows = await db
    .select({ shop: shops, role: shopMembers.role })
    .from(shopMembers)
    .innerJoin(shops, eq(shops.id, shopMembers.shopId))
    .where(eq(shopMembers.userId, user.id))
    .orderBy(asc(shops.shortCode));
  const match = wanted ? rows.find((r) => r.shop.shortCode === wanted) : rows[0];
  if (!match) throw forbidden();
  const isOwner = match.role === 'shop_owner';
  if (opts.ownerOnly && !isOwner) {
    throw new HttpError(403, 'owner_only', 'Only the shop owner can change this');
  }
  return { user, shop: match.shop, isOwner };
}

/** Marshals act on their own cluster; admins pick one with ?cluster=ID (default: first active). */
export async function requireCluster(
  db: Db,
  req: HttpRequest,
): Promise<{ user: SessionUser; cluster: ClusterRow }> {
  const user = await requireRole(db, req, ['marshal', 'admin']);
  const wanted = req.query.get('cluster')?.trim() || null;

  if (user.role === 'admin') {
    const [cluster] = wanted
      ? await db.select().from(clusters).where(eq(clusters.id, wanted))
      : await db
          .select()
          .from(clusters)
          .where(eq(clusters.isActive, true))
          .orderBy(asc(clusters.name))
          .limit(1);
    if (!cluster) throw new HttpError(404, 'cluster_not_found', 'No such cluster');
    return { user, cluster };
  }

  const rows = await db
    .select({ cluster: clusters })
    .from(clusterMarshals)
    .innerJoin(clusters, eq(clusters.id, clusterMarshals.clusterId))
    .where(
      wanted
        ? and(eq(clusterMarshals.userId, user.id), eq(clusters.id, wanted))
        : eq(clusterMarshals.userId, user.id),
    )
    .orderBy(asc(clusters.name));
  if (!rows[0]) throw forbidden();
  return { user, cluster: rows[0].cluster };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireUuidParam(req: HttpRequest, name: string): string {
  const v = req.params[name];
  if (!v || !UUID_RE.test(v)) throw new HttpError(404, 'not_found', 'Not found');
  return v;
}
