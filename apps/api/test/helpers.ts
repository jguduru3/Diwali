import {
  HttpRequest,
  InvocationContext,
  type HttpHandler,
  type HttpResponseInit,
} from '@azure/functions';
import { eq } from 'drizzle-orm';
import { CONSENT_VERSION, SESSION_COOKIE, type Role } from '@pataka/shared';
import { getDb } from '../src/db/client';
import {
  categories,
  clusterMarshals,
  clusters,
  items,
  shopLicences,
  shopMembers,
  shopPriceVersions,
  shops,
  users,
} from '../src/db/schema';
import { otpRequestHandler, otpVerifyHandler } from '../src/functions/auth';
import { signSession } from '../src/lib/auth';
import { route } from '../src/lib/http';

type Call = {
  method?: string;
  body?: unknown;
  session?: string | null;
  csrf?: boolean;
  ip?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
};

/** Runs a handler through the same `route()` wrapper the Functions host uses. */
export async function call(
  handler: (req: HttpRequest) => Promise<HttpResponseInit>,
  { method = 'GET', body, session, csrf = true, ip, params, query, headers: extra }: Call = {},
): Promise<HttpResponseInit> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (csrf) headers['x-pp'] = '1';
  if (session) headers.cookie = `${SESSION_COOKIE}=${session}`;
  if (ip) headers['x-forwarded-for'] = ip;
  const url = new URL('http://localhost/api/test');
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const req = new HttpRequest({
    method,
    url: url.toString(),
    headers,
    params,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
  const wrapped: HttpHandler = route((r) => handler(r));
  return (await wrapped(req, new InvocationContext())) as HttpResponseInit;
}

export function sessionFrom(res: HttpResponseInit): string | null {
  return res.cookies?.find((c) => c.name === SESSION_COOKIE)?.value ?? null;
}

export function errorCode(res: HttpResponseInit): string | undefined {
  return (res.jsonBody as { error?: { code: string } } | undefined)?.error?.code;
}

export const body = <T>(res: HttpResponseInit) => res.jsonBody as T;

/** Full OTP sign-in (dev code 123456); returns the session token. */
export async function signIn(phone: string): Promise<string> {
  await call(otpRequestHandler, { method: 'POST', body: { phone } });
  const res = await call(otpVerifyHandler, {
    method: 'POST',
    body: { phone, code: '123456', consentVersion: CONSENT_VERSION },
  });
  if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.jsonBody)}`);
  return sessionFrom(res)!;
}

let phoneSeq = 0;
/** Creates a user and a valid session without going through OTP. */
export async function makeUser(role: Role = 'customer') {
  phoneSeq++;
  const phoneE164 = `+9188${String(phoneSeq).padStart(8, '0')}`;
  const [user] = await getDb().insert(users).values({ phoneE164, role }).returning();
  const { token } = await signSession(user!);
  return { user: user!, session: token };
}

export async function makeAdmin(phone: string) {
  await getDb().insert(users).values({ phoneE164: phone, role: 'admin' });
}

export async function makeShop(shortCode = 'SLC01') {
  const [cluster] = await getDb()
    .insert(clusters)
    .values({ name: `Ground ${shortCode}`, area: 'Gachibowli' })
    .returning();
  const [shop] = await getDb()
    .insert(shops)
    .values({ shortCode, name: `Shop ${shortCode}`, area: 'Gachibowli', clusterId: cluster!.id })
    .returning();
  return { cluster: cluster!, shop: shop! };
}

/**
 * A listed shop: live, verified in-date licence, two categories (one banned)
 * and four items — #1–#3 with barcodes BC<code>-1..3, #3 with stock 1, #4 with
 * no barcode. Returns sessions for owner, staff, packer, cashier and marshal.
 */
export async function makeListedShop(shortCode = 'SLC01') {
  const db = getDb();
  const { cluster, shop } = await makeShop(shortCode);
  await db
    .update(shops)
    .set({ isLive: true, openFrom: '00:00', openTo: '23:30' })
    .where(eq(shops.id, shop.id));
  await db.insert(shopLicences).values({
    shopId: shop.id,
    licenceNo: `LE5/${shortCode}`,
    licenceType: 'LE-5',
    validFrom: '2020-01-01',
    validTo: '2099-12-31',
    imageBlobPath: 'x.png',
    status: 'verified',
  });
  await db.insert(shopPriceVersions).values({ shopId: shop.id, version: 1 });
  const [allowed] = await db
    .insert(categories)
    .values({ slug: `sparklers-${shortCode.toLowerCase()}`, nameEn: 'Sparklers' })
    .returning();
  const [banned] = await db
    .insert(categories)
    .values({
      slug: `lari-${shortCode.toLowerCase()}`,
      nameEn: 'Lari',
      isBanned: true,
      bannedReason: 'Joined crackers banned',
    })
    .returning();
  const itemRows = await db
    .insert(items)
    .values(
      [1, 2, 3, 4].map((n) => ({
        shopId: shop.id,
        itemNo: n,
        categoryId: allowed!.id,
        nameEn: `Item ${n}`,
        pricePaise: n * 10000,
        greenCert: 'CSIR_NEERI_SWAS' as const,
        greenRef: `REF-${n}`,
        rackCode: `A${n}`,
        barcode: n < 4 ? `BC${shortCode}-${n}` : null,
        stockQty: n === 3 ? 1 : null,
      })),
    )
    .returning();
  const owner = await makeUser('shop_owner');
  const staff = await makeUser('shop_staff');
  const packer = await makeUser('shop_packer');
  const cashier = await makeUser('shop_cashier');
  const marshal = await makeUser('marshal');
  await db.insert(shopMembers).values([
    { shopId: shop.id, userId: owner.user.id, role: 'shop_owner' },
    { shopId: shop.id, userId: staff.user.id, role: 'shop_staff' },
    { shopId: shop.id, userId: packer.user.id, role: 'shop_packer' },
    { shopId: shop.id, userId: cashier.user.id, role: 'shop_cashier' },
  ]);
  await db.insert(clusterMarshals).values({ clusterId: cluster.id, userId: marshal.user.id });
  return {
    cluster,
    shop,
    items: itemRows,
    allowedCategory: allowed!,
    bannedCategory: banned!,
    owner,
    staff,
    packer,
    cashier,
    marshal,
  };
}
