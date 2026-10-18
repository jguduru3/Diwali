import { vi } from 'vitest';
import type { DemoInfo, ItemsResponse, Me, Role, ShopSummary } from '@pataka/shared';

export const ID = '00000000-0000-4000-8000-000000000001';
export const SHOP_ID = '00000000-0000-4000-8000-000000000002';
export const CAT_ID = '00000000-0000-4000-8000-000000000003';

export function account(role: Role): Me {
  return {
    id: ID,
    phone: '+919000000011',
    displayName: null,
    role,
    memberships:
      role === 'shop_owner' || role === 'shop_staff'
        ? [{ kind: 'shop', id: SHOP_ID, name: 'Sri Lakshmi Crackers', code: 'SLC01', role }]
        : [],
  };
}

export const shopSummary: ShopSummary = {
  shortCode: 'SLC01',
  name: 'Sri Lakshmi Crackers',
  area: 'Gachibowli',
  address: null,
  lat: 17.44,
  lng: 78.35,
  photoUrl: null,
  openFrom: '10:00',
  openTo: '22:00',
  openNow: true,
  distanceKm: null,
  licence: { licenceNo: 'LE5/1', licenceType: 'LE-5', validTo: '2026-11-30' },
  cluster: null,
  nextFreeSlot: null,
};

export const itemsResponse: ItemsResponse = {
  shopCode: 'SLC01',
  priceVersion: 3,
  categories: [
    {
      id: CAT_ID,
      slug: 'sparklers',
      nameEn: 'Sparklers',
      nameTe: null,
      sort: 1,
      isBanned: false,
      bannedReason: null,
    },
  ],
  items: [1, 2, 3].map((n) => ({
    id: `00000000-0000-4000-8000-00000000010${n}`,
    itemNo: n,
    categoryId: CAT_ID,
    nameEn: `Sparkler ${n}`,
    nameTe: null,
    packDesc: '10 pcs',
    pricePaise: n * 10000,
    priceVersion: n === 2 ? 3 : 1,
    greenCert: 'CSIR_NEERI_SWAS' as const,
    greenRef: `R${n}`,
    rackCode: n === 3 ? 'B1' : 'A1',
    imageUrl: null,
    isSoldOut: n === 3,
    isActive: true,
  })),
};

export type Call = { url: string; method: string; body: string | null };

/** Fake API. Records every request so tests can assert what left the device. */
export function mockApi(
  me: Me | null,
  opts: { demo?: boolean; extra?: Record<string, unknown> } = {},
) {
  const calls: Call[] = [];
  const demo: DemoInfo = {
    enabled: !!opts.demo,
    accounts: opts.demo
      ? [
          { phone: '+919000000099', displayName: 'Demo customer', role: 'customer', context: null },
          {
            phone: '+919000000011',
            displayName: 'Owner',
            role: 'shop_owner',
            context: 'Sri Lakshmi Crackers',
          },
          { phone: '+919000000001', displayName: 'Admin', role: 'admin', context: null },
        ]
      : [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: (init?.body as string) ?? null });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      const path = url.replace(/^\/api/, '').split('?')[0]!;
      for (const [k, v] of Object.entries(opts.extra ?? {})) if (path === k) return json(v);
      if (path === '/me')
        return me ? json(me) : json({ error: { code: 'unauthorized', message: '' } }, 401);
      if (path === '/auth/demo') return json(demo);
      if (path === '/areas')
        return json([{ area: 'Gachibowli', lat: 17.44, lng: 78.35, shopCount: 1 }]);
      if (path === '/shops') return json([shopSummary]);
      if (path === '/console/members') return json({ members: [], shops: [], clusters: [] });
      if (path === '/console/metrics')
        return json({ from: '', to: '', visibleShops: 1, totalShops: 1, rows: [] });
      if (path === '/console/licences') return json([]);
      if (path === '/visits/current') return json({ visit: null });
      return json({ error: { code: 'not_found', message: '' } }, 404);
    }),
  );
  return calls;
}
