import type { HttpRequest } from '@azure/functions';
import { and, asc, eq } from 'drizzle-orm';
import { VENDOR_ROLES, type VendorRole } from '@pataka/shared';
import type { Db } from '../db/client';
import { clusterMarshals, clusters, shopMembers, shops } from '../db/schema';
import { requireRole, type SessionUser } from './auth';
import { forbidden, HttpError } from './errors';

export type ShopRow = typeof shops.$inferSelect;
export type ClusterRow = typeof clusters.$inferSelect;
export type ShopRole = VendorRole | 'admin';
export type ShopAccess = { user: SessionUser; shop: ShopRow; isOwner: boolean; role: ShopRole };

/** Which shop roles may do what (SPEC_V3 §3). Admins can do everything. */
export const SHOP_ABILITIES = {
  catalogue: ['shop_owner'],
  soldOut: ['shop_owner', 'shop_staff', 'shop_packer'],
  orders: ['shop_owner', 'shop_staff'],
  packing: ['shop_owner', 'shop_staff', 'shop_packer'],
  counter: ['shop_owner', 'shop_staff', 'shop_cashier'],
  view: ['shop_owner', 'shop_staff', 'shop_packer', 'shop_cashier'],
} as const satisfies Record<string, readonly VendorRole[]>;
export type ShopAbility = keyof typeof SHOP_ABILITIES;

/**
 * Row-level authorisation for the shop app (SPEC §10). Vendors act on their own
 * shop; admins pick one with ?shop=CODE. `ownerOnly` excludes all other staff;
 * `can` limits the call to the roles allowed that ability.
 */
export async function requireShop(
  db: Db,
  req: HttpRequest,
  opts: { ownerOnly?: boolean; can?: ShopAbility } = {},
): Promise<ShopAccess> {
  const user = await requireRole(db, req, [...VENDOR_ROLES, 'admin']);
  const wanted = req.query.get('shop')?.trim().toUpperCase() || null;

  if (user.role === 'admin') {
    const [shop] = wanted
      ? await db.select().from(shops).where(eq(shops.shortCode, wanted))
      : await db.select().from(shops).orderBy(asc(shops.shortCode)).limit(1);
    if (!shop) throw new HttpError(404, 'shop_not_found', 'No shop with that code');
    return { user, shop, isOwner: true, role: 'admin' };
  }

  const rows = await db
    .select({ shop: shops, role: shopMembers.role })
    .from(shopMembers)
    .innerJoin(shops, eq(shops.id, shopMembers.shopId))
    .where(eq(shopMembers.userId, user.id))
    .orderBy(asc(shops.shortCode));
  const match = wanted ? rows.find((r) => r.shop.shortCode === wanted) : rows[0];
  if (!match) throw forbidden();
  const role = match.role as VendorRole;
  const isOwner = role === 'shop_owner';
  if (opts.ownerOnly && !isOwner) {
    throw new HttpError(403, 'owner_only', 'Only the shop owner can change this');
  }
  if (opts.can && !(SHOP_ABILITIES[opts.can] as readonly VendorRole[]).includes(role)) {
    throw new HttpError(403, 'role_not_allowed', 'Your shop role cannot do this');
  }
  return { user, shop: match.shop, isOwner, role };
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
