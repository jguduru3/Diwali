// Dev/demo seed (SPEC §6.4). Idempotent: safe to run again.
//   pnpm db:seed
import { eq } from 'drizzle-orm';
import {
  PLATFORM_FEE_PAISE,
  confirmBy,
  effectivePrice,
  encodeOrderQr,
  istDate,
  type GreenCert,
  type Role,
} from '@pataka/shared';
import { closeDb, getDb } from '../src/db/client';
import {
  categories,
  clusterMarshals,
  clusters,
  items,
  shopLicences,
  shopMembers,
  shopPriceVersions,
  feePayments,
  orderLines,
  orders,
  shops,
  users,
} from '../src/db/schema';
import { hashSecret } from '../src/lib/orders';
import { fileStore } from '../src/lib/storage';
import { demoLicencePng } from './demoLicenceImage.mjs';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
const db = getDb();
const phone = (n: number) => `+9190000000${String(n).padStart(2, '0')}`;

// ---- Categories (G7: two banned) ----

const categoryDefs = [
  { slug: 'sparklers', nameEn: 'Sparklers', nameTe: 'కాకరపువ్వొత్తులు', sort: 10 },
  { slug: 'flower-pots', nameEn: 'Flower pots', nameTe: 'చిచ్చుబుడ్లు', sort: 20 },
  { slug: 'ground-chakkar', nameEn: 'Ground chakkar', nameTe: 'భూచక్రాలు', sort: 30 },
  { slug: 'pencils', nameEn: 'Pencils', nameTe: 'పెన్సిళ్లు', sort: 40 },
  { slug: 'twinkling-stars', nameEn: 'Twinkling stars', nameTe: 'మెరిసే నక్షత్రాలు', sort: 50 },
  { slug: 'rockets', nameEn: 'Rockets', nameTe: 'రాకెట్లు', sort: 60 },
  { slug: 'aerial-shots', nameEn: 'Aerial shots', nameTe: 'ఆకాశ షాట్లు', sort: 70 },
  { slug: 'fountains', nameEn: 'Fountains', nameTe: 'ఫౌంటెన్లు', sort: 80 },
  {
    slug: 'sound-crackers-green',
    nameEn: 'Green sound crackers',
    nameTe: 'గ్రీన్ సౌండ్ టపాసులు',
    sort: 90,
  },
  { slug: 'kids-safe', nameEn: 'Kids-safe', nameTe: 'పిల్లలకు సురక్షితం', sort: 100 },
  {
    slug: 'series-lari',
    nameEn: 'Series / lari',
    nameTe: 'సిరీస్ / లడీ',
    sort: 900,
    isBanned: true,
    bannedReason: 'Joined crackers banned — SC order 2018/2021',
  },
  {
    slug: 'barium-based',
    nameEn: 'Barium-based',
    nameTe: 'బేరియం ఆధారిత',
    sort: 910,
    isBanned: true,
    bannedReason: 'Barium salts banned — SC order 2018/2021',
  },
];
for (const c of categoryDefs) {
  await db
    .insert(categories)
    .values(c)
    .onConflictDoUpdate({
      target: categories.slug,
      set: { nameEn: c.nameEn, nameTe: c.nameTe, sort: c.sort },
    });
}
const catId = new Map(
  (await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [
    c.slug,
    c.id,
  ]),
);

// ---- Accounts ----

async function upsertUser(phoneE164: string, role: Role, displayName: string) {
  const [row] = await db
    .insert(users)
    .values({ phoneE164, role, displayName })
    .onConflictDoUpdate({ target: users.phoneE164, set: { role, displayName } })
    .returning();
  return row!;
}

// ---- Places ----

async function upsertCluster(v: typeof clusters.$inferInsert) {
  const [existing] = await db.select().from(clusters).where(eq(clusters.name, v.name));
  if (existing) return existing;
  const [row] = await db.insert(clusters).values(v).returning();
  return row!;
}

const gachibowli = await upsertCluster({
  name: 'Gachibowli Stadium Ground',
  area: 'Gachibowli',
  lat: 17.4401,
  lng: 78.3489,
  address: 'Old Mumbai Hwy, near GMC Balayogi Stadium, Gachibowli, Hyderabad 500032',
  gateNotes: 'Enter from Gate 2. Express Pickup counters are at the front of each stall.',
});
const madhapur = await upsertCluster({
  name: 'Madhapur Cracker Mela',
  area: 'Madhapur',
  lat: 17.4483,
  lng: 78.3915,
  address: 'Ayyappa Society open ground, Madhapur, Hyderabad 500081',
  gateNotes: 'Park along the north wall; Express Pickup counters face the road.',
});

// A drawn "licence document" used as the demo licence photo.
await fileStore().put('seed/demo-licence.png', demoLicencePng(), 'image/png');

type ItemDef = [
  slug: string,
  en: string,
  te: string,
  pack: string,
  rupees: number,
  cert: GreenCert,
  rack: string,
];
const catalogue: ItemDef[] = [
  [
    'sparklers',
    'Electric Sparklers 10 cm',
    'ఎలక్ట్రిక్ కాకరపువ్వొత్తులు 10 సెం.మీ',
    '10 pcs',
    60,
    'CSIR_NEERI_SWAS',
    'A1',
  ],
  [
    'sparklers',
    'Colour Sparklers 15 cm',
    'కలర్ కాకరపువ్వొత్తులు 15 సెం.మీ',
    '10 pcs',
    90,
    'CSIR_NEERI_SWAS',
    'A1',
  ],
  [
    'sparklers',
    'Green Sparklers 30 cm',
    'గ్రీన్ కాకరపువ్వొత్తులు 30 సెం.మీ',
    '5 pcs',
    140,
    'CSIR_NEERI_STAR',
    'A2',
  ],
  [
    'flower-pots',
    'Flower Pots Small',
    'చిన్న చిచ్చుబుడ్లు',
    '10 pcs',
    180,
    'CSIR_NEERI_SAFAL',
    'B1',
  ],
  [
    'flower-pots',
    'Flower Pots Deluxe',
    'డీలక్స్ చిచ్చుబుడ్లు',
    '5 pcs',
    320,
    'CSIR_NEERI_SAFAL',
    'B1',
  ],
  [
    'ground-chakkar',
    'Ground Chakkar Big',
    'పెద్ద భూచక్రాలు',
    '10 pcs',
    150,
    'CSIR_NEERI_SWAS',
    'B2',
  ],
  [
    'ground-chakkar',
    'Ground Chakkar Deluxe',
    'డీలక్స్ భూచక్రాలు',
    '10 pcs',
    260,
    'CSIR_NEERI_STAR',
    'B2',
  ],
  ['pencils', 'Colour Pencils', 'కలర్ పెన్సిళ్లు', '10 pcs', 110, 'CSIR_NEERI_SWAS', 'A3'],
  [
    'twinkling-stars',
    'Twinkling Star 1.5 inch',
    'మెరిసే నక్షత్రం 1.5 అంగుళాలు',
    '10 pcs',
    80,
    'CSIR_NEERI_SWAS',
    'A3',
  ],
  ['rockets', 'Baby Rockets', 'చిన్న రాకెట్లు', '10 pcs', 240, 'CSIR_NEERI_STAR', 'C1'],
  ['rockets', 'Whistling Rockets', 'విజిల్ రాకెట్లు', '5 pcs', 300, 'CSIR_NEERI_STAR', 'C1'],
  ['aerial-shots', 'Sky Shot 7', 'స్కై షాట్ 7', '1 box', 450, 'CSIR_NEERI_SAFAL', 'C2'],
  [
    'aerial-shots',
    'Colour Rain 12 Shot',
    'కలర్ రెయిన్ 12 షాట్',
    '1 box',
    780,
    'CSIR_NEERI_SAFAL',
    'C2',
  ],
  ['fountains', 'Gold Fountain', 'గోల్డ్ ఫౌంటెన్', '1 pc', 220, 'CSIR_NEERI_STAR', 'B3'],
  [
    'sound-crackers-green',
    'Green Bijili',
    'గ్రీన్ బిజిలీ',
    '100 pcs',
    120,
    'CSIR_NEERI_SWAS',
    'D1',
  ],
  [
    'sound-crackers-green',
    'Green Atom Bomb',
    'గ్రీన్ ఆటమ్ బాంబ్',
    '10 pcs',
    200,
    'CSIR_NEERI_SWAS',
    'D1',
  ],
  ['kids-safe', 'Kids Combo Box', 'పిల్లల కాంబో బాక్స్', '1 box', 650, 'CSIR_NEERI_OTHER', 'A4'],
];

const shopDefs = [
  {
    code: 'SLC01',
    name: 'Sri Lakshmi Crackers',
    area: 'Gachibowli',
    cluster: gachibowli,
    n: 1,
    lat: 17.4405,
    lng: 78.3495,
    factor: 1,
    skip: [15, 16],
  },
  {
    code: 'BAL01',
    name: 'Balaji Fireworks',
    area: 'Gachibowli',
    cluster: gachibowli,
    n: 2,
    lat: 17.4398,
    lng: 78.3482,
    factor: 0.95,
    skip: [2, 12],
  },
  {
    code: 'ANA01',
    name: 'Anand Crackers',
    area: 'Madhapur',
    cluster: madhapur,
    n: 3,
    lat: 17.4486,
    lng: 78.3921,
    factor: 1.05,
    skip: [0, 6],
  },
  {
    code: 'DEM01',
    name: 'Diya Demo Crackers',
    area: 'Kondapur',
    cluster: madhapur,
    n: 4,
    lat: 17.46,
    lng: 78.357,
    factor: 1.1,
    skip: [9, 13],
  },
];

await upsertUser(phone(1), 'admin', 'Diwali Express Pickup team');

for (const s of shopDefs) {
  const [shop] = await db
    .insert(shops)
    .values({
      shortCode: s.code,
      name: s.name,
      area: s.area,
      clusterId: s.cluster.id,
      lat: s.lat,
      lng: s.lng,
      address: `Stall ${s.n * 7}, ${s.cluster.name}`,
      phoneE164: phone(s.n * 10 + 1),
      openFrom: '10:00',
      openTo: '22:00',
      isLive: true,
    })
    .onConflictDoUpdate({
      target: shops.shortCode,
      set: { name: s.name, clusterId: s.cluster.id, lat: s.lat, lng: s.lng, isLive: true },
    })
    .returning();
  const shopId = shop!.id;

  const owner = await upsertUser(phone(s.n * 10 + 1), 'shop_owner', `${s.name} — owner`);
  const staff = await upsertUser(phone(s.n * 10 + 2), 'shop_staff', `${s.name} — staff`);
  const packer = await upsertUser(phone(s.n * 10 + 3), 'shop_packer', `${s.name} — packer`);
  const cashier = await upsertUser(phone(s.n * 10 + 4), 'shop_cashier', `${s.name} — cashier`);
  for (const [u, role] of [
    [owner, 'shop_owner'],
    [staff, 'shop_staff'],
    [packer, 'shop_packer'],
    [cashier, 'shop_cashier'],
  ] as const) {
    await db.insert(shopMembers).values({ shopId, userId: u.id, role }).onConflictDoNothing();
  }

  const [lic] = await db.select().from(shopLicences).where(eq(shopLicences.shopId, shopId));
  if (!lic) {
    await db.insert(shopLicences).values({
      shopId,
      licenceNo: `LE5/HYD/2026/${1040 + s.n}`,
      licenceType: s.n % 2 ? 'LE-5' : 'Temporary',
      issuedBy: 'Commissioner of Police, Cyberabad',
      validFrom: '2026-10-01',
      validTo: '2026-11-30',
      imageBlobPath: 'seed/demo-licence.png',
      status: 'verified',
      verifiedAt: new Date(),
    });
  }

  const picked = catalogue.filter((_, i) => !s.skip.includes(i));
  let itemNo = 0;
  for (const [slug, en, te, pack, rupees, cert, rack] of picked) {
    itemNo++;
    const pricePaise = Math.round((rupees * s.factor) / 5) * 500;
    const values = {
      shopId,
      itemNo,
      categoryId: catId.get(slug)!,
      nameEn: en,
      nameTe: te,
      packDesc: pack,
      pricePaise,
      greenCert: cert,
      greenRef: `NEERI-${cert.split('_').pop()}-26-${String(1000 + s.n * 100 + itemNo)}`,
      rackCode: rack,
      // Demo barcodes: 89 + shop number + item number. Every 5th item tracks a low
      // stock; every 4th runs a 15% offer.
      barcode: `89${s.n}${String(itemNo).padStart(4, '0')}`,
      stockQty: itemNo % 5 === 0 ? 3 : null,
      offerPricePaise: itemNo % 4 === 1 ? Math.round((pricePaise * 0.85) / 500) * 500 : null,
    };
    await db
      .insert(items)
      .values(values)
      .onConflictDoUpdate({ target: [items.shopId, items.itemNo], set: values });
  }
  // Sold by weight at SLC01: a loose item at its own ₹/kg, and a mix box of any items at a fixed ₹/kg.
  if (s.code === 'SLC01') {
    const weighed = [
      {
        slug: 'flower-pots',
        nameEn: 'Loose Flower Pots',
        nameTe: 'విడి చిచ్చుబుడ్లు',
        packDesc: 'per kg',
        pricePaise: 60000,
        saleUnit: 'kg' as const,
        stockQty: 20_000,
        barcode: '8919001',
      },
      {
        slug: 'sparklers',
        nameEn: 'Mix box — any crackers by weight',
        nameTe: 'మిక్స్ బాక్స్ — ఏ టపాసులైనా బరువు ప్రకారం',
        packDesc: 'per kg, your choice of items',
        pricePaise: 70000,
        saleUnit: 'mix_kg' as const,
        stockQty: null,
        barcode: null,
      },
    ];
    for (const w of weighed) {
      itemNo++;
      const values = {
        shopId,
        itemNo,
        categoryId: catId.get(w.slug)!,
        nameEn: w.nameEn,
        nameTe: w.nameTe,
        packDesc: w.packDesc,
        pricePaise: w.pricePaise,
        saleUnit: w.saleUnit,
        stockQty: w.stockQty,
        barcode: w.barcode,
        greenCert: 'CSIR_NEERI_SWAS' as GreenCert,
        greenRef: `NEERI-SWAS-26-W${itemNo}`,
        rackCode: 'W1',
      };
      await db
        .insert(items)
        .values(values)
        .onConflictDoUpdate({ target: [items.shopId, items.itemNo], set: values });
    }
  }
  await db.insert(shopPriceVersions).values({ shopId, version: 1 }).onConflictDoNothing();
}

// A shop waiting for licence approval (try it in Admin → Licences).
const [pendingShop] = await db
  .insert(shops)
  .values({
    shortCode: 'SAI01',
    name: 'Sai Ganesh Fireworks',
    area: 'Hitec City',
    clusterId: madhapur.id,
    lat: 17.4474,
    lng: 78.3762,
    address: 'Stall 41, Madhapur Cracker Mela',
    openFrom: '11:00',
    openTo: '21:00',
    isLive: false,
  })
  .onConflictDoUpdate({ target: shops.shortCode, set: { name: 'Sai Ganesh Fireworks' } })
  .returning();
await db
  .insert(shopPriceVersions)
  .values({ shopId: pendingShop!.id, version: 1 })
  .onConflictDoNothing();
const [pendingLic] = await db
  .select()
  .from(shopLicences)
  .where(eq(shopLicences.shopId, pendingShop!.id));
if (!pendingLic) {
  await db.insert(shopLicences).values({
    shopId: pendingShop!.id,
    licenceNo: 'TMP/CYB/2026/0217',
    licenceType: 'Temporary',
    issuedBy: 'Commissioner of Police, Cyberabad',
    validFrom: '2026-10-10',
    validTo: '2026-11-15',
    imageBlobPath: 'seed/demo-licence.png',
  });
}
for (const [i, catalogueIdx] of [0, 3, 5, 9, 13].entries()) {
  const [slug, en, te, pack, rupees, cert, rack] = catalogue[catalogueIdx]!;
  const values = {
    shopId: pendingShop!.id,
    itemNo: i + 1,
    categoryId: catId.get(slug)!,
    nameEn: en,
    nameTe: te,
    packDesc: pack,
    pricePaise: rupees * 100,
    greenCert: cert,
    greenRef: `NEERI-${cert.split('_').pop()}-26-9${i}`,
    rackCode: rack,
  };
  await db
    .insert(items)
    .values(values)
    .onConflictDoUpdate({ target: [items.shopId, items.itemNo], set: values });
}

for (const [i, cluster] of [gachibowli, madhapur].entries()) {
  const marshal = await upsertUser(phone(51 + i), 'marshal', `${cluster.area} gate marshal`);
  await db
    .insert(clusterMarshals)
    .values({ clusterId: cluster.id, userId: marshal.id })
    .onConflictDoNothing();
}

await upsertUser(phone(99), 'customer', 'Demo customer');

// ---- Demo orders at SLC01 (mock ₹30 fee; no real money) ----
// +91 90000 00091: placed, waiting for the merchant to confirm.
// +91 90000 00092: packed — QRs below let you try the Express Pickup counter.

const DEMO_PICKUP_SECRET = 'DEMXQR0000000000000000092A';
const DEMO_PACK_SECRET = 'DEMXPACK000000000000000092';
const [slc] = await db.select().from(shops).where(eq(shops.shortCode, 'SLC01'));
const slcItems = await db
  .select()
  .from(items)
  .where(eq(items.shopId, slc!.id))
  .orderBy(items.itemNo)
  .limit(6);

async function demoOrder(
  n: number,
  code: string,
  status: 'placed' | 'packed',
  picks: { idx: number; qty: number }[],
) {
  const customer = await upsertUser(phone(n), 'customer', `Demo customer ${n - 90}`);
  const [existing] = await db.select().from(orders).where(eq(orders.code, code));
  if (existing) return;
  const now = new Date();
  const lines = picks.map((p, i) => {
    const it = slcItems[p.idx]!;
    return { it, qty: p.qty, unit: effectivePrice(it, now), lineNo: i + 1 };
  });
  const total = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  const packed = status === 'packed';
  const [o] = await db
    .insert(orders)
    .values({
      code,
      userId: customer.id,
      shopId: slc!.id,
      status,
      feePaise: PLATFORM_FEE_PAISE,
      estimatedTotalPaise: total,
      feePaidAt: now,
      confirmBy: confirmBy(now),
      ...(packed
        ? {
            confirmedAt: now,
            packingStartedAt: now,
            packedAt: now,
            finalTotalPaise: total,
            packNo: 1,
            packDay: istDate(now),
            customerQrHash: hashSecret(DEMO_PICKUP_SECRET),
            packQrHash: hashSecret(DEMO_PACK_SECRET),
          }
        : {}),
    })
    .returning();
  await db.insert(orderLines).values(
    lines.map((l) => ({
      orderId: o!.id,
      lineNo: l.lineNo,
      itemId: l.it.id,
      itemNo: l.it.itemNo,
      nameEn: l.it.nameEn,
      nameTe: l.it.nameTe,
      packDesc: l.it.packDesc,
      unitPricePaise: l.unit,
      qty: l.qty,
      status: packed ? ('picked' as const) : ('pending' as const),
      pickedQty: packed ? l.qty : 0,
    })),
  );
  await db.insert(feePayments).values({
    orderId: o!.id,
    provider: 'mock',
    checkoutId: `mock_ck_seed_${code}`,
    checkoutUrl: `/pay/mock/mock_ck_seed_${code}`,
    providerPaymentId: `mock_pay_seed_${code}`,
    status: 'captured',
    amountPaise: PLATFORM_FEE_PAISE,
    idempotencyKey: `fee:${o!.id}:1`,
    capturedAt: now,
  });
}

await demoOrder(91, 'DEM091', 'placed', [
  { idx: 0, qty: 2 },
  { idx: 2, qty: 1 },
  { idx: 4, qty: 3 },
]);
await demoOrder(92, 'DEM092', 'packed', [
  { idx: 1, qty: 1 },
  { idx: 3, qty: 2 },
]);

await closeDb();
console.log(`Seeded Diwali Express Pickup demo data.
  Shops: SLC01, BAL01, ANA01, DEM01 (live) · SAI01 (licence pending)
  Accounts (OTP 123456 in dev, or one tap in demo mode):
    admin        ${phone(1)}
    shop owner   ${phone(11)} (SLC01)     staff ${phone(12)}   packer ${phone(13)}   cashier ${phone(14)}
    marshal      ${phone(51)} (Gachibowli)
    customer     ${phone(99)}
    customers    ${phone(91)} (order placed)   ${phone(92)} (order packed)
  Barcodes at SLC01: 891 + item number, e.g. 8910001
  Packed order DEM-092 — pickup QR: ${encodeOrderQr('customer', DEMO_PICKUP_SECRET)}
                         pack sticker: ${encodeOrderQr('pack', DEMO_PACK_SECRET)}`);
