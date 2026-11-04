// Dev/demo seed (SPEC §6.4). Idempotent: safe to run again.
//   pnpm db:seed
import { eq, sql } from 'drizzle-orm';
import {
  PLATFORM_FEE_PAISE,
  confirmBy,
  ean13CheckDigit,
  effectivePrice,
  encodeOrderQr,
  istDate,
  resolvePricing,
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
import { seedGrowth } from './seedGrowth.mjs';
import { seedPacks } from './seedPacks.mjs';

loadLocalSettings();
// Demo data only: never against a live database.
const azureDb = /\.postgres\.database\.azure\.com/.test(process.env.DATABASE_URL ?? '');
if (process.env.APP_ENV === 'prod' || (azureDb && process.env.SEED_ALLOW_AZURE !== 'true')) {
  console.error(
    'Refusing to seed demo data here. For the Azure dev database set SEED_ALLOW_AZURE=true.',
  );
  process.exit(1);
}
const db = getDb();
const phone = (n: number) => `+9190000000${String(n).padStart(2, '0')}`;

// ---- Categories (G7: two banned) ----

const categoryDefs = [
  {
    slug: 'sparklers',
    nameEn: 'Sparklers',
    nameTe: 'కాకరపువ్వొత్తులు',
    nameHi: 'फुलझड़ियाँ',
    sort: 10,
  },
  { slug: 'flower-pots', nameEn: 'Flower pots', nameTe: 'చిచ్చుబుడ్లు', nameHi: 'अनार', sort: 20 },
  {
    slug: 'ground-chakkar',
    nameEn: 'Ground chakkar',
    nameTe: 'భూచక్రాలు',
    nameHi: 'ज़मीन चकरी',
    sort: 30,
  },
  { slug: 'pencils', nameEn: 'Pencils', nameTe: 'పెన్సిళ్లు', nameHi: 'पेंसिल', sort: 40 },
  {
    slug: 'twinkling-stars',
    nameEn: 'Twinkling stars',
    nameTe: 'మెరిసే నక్షత్రాలు',
    nameHi: 'टिमटिमाते तारे',
    sort: 50,
  },
  { slug: 'rockets', nameEn: 'Rockets', nameTe: 'రాకెట్లు', nameHi: 'रॉकेट', sort: 60 },
  {
    slug: 'aerial-shots',
    nameEn: 'Aerial shots',
    nameTe: 'ఆకాశ షాట్లు',
    nameHi: 'आसमानी शॉट',
    sort: 70,
  },
  { slug: 'fountains', nameEn: 'Fountains', nameTe: 'ఫౌంటెన్లు', nameHi: 'फव्वारे', sort: 80 },
  {
    slug: 'sound-crackers-green',
    nameEn: 'Green sound crackers',
    nameTe: 'గ్రీన్ సౌండ్ టపాసులు',
    nameHi: 'ग्रीन आवाज़ वाले पटाखे',
    sort: 90,
  },
  {
    slug: 'bombs',
    nameEn: 'Bombs',
    nameTe: 'బాంబులు',
    nameHi: 'बम',
    sort: 92,
  },
  {
    slug: 'walas',
    nameEn: "Wala's",
    nameTe: 'వాలాలు',
    nameHi: 'लड़ी / वाला',
    sort: 95,
  },
  {
    slug: 'kids-safe',
    nameEn: 'Kids-safe',
    nameTe: 'పిల్లలకు సురక్షితం',
    nameHi: 'बच्चों के लिए सुरक्षित',
    sort: 100,
  },
  {
    slug: 'kids-combo',
    nameEn: 'Kids combo packs',
    nameTe: 'పిల్లల కాంబో ప్యాక్స్',
    nameHi: 'किड्स कॉम्बो पैक',
    sort: 105,
  },
  {
    slug: 'gift-packs',
    nameEn: 'Gift packs',
    nameTe: 'గిఫ్ట్ ప్యాక్స్',
    nameHi: 'गिफ्ट पैक',
    sort: 110,
  },
  {
    slug: 'family-packs',
    nameEn: 'Family packs',
    nameTe: 'ఫ్యామిలీ ప్యాక్స్',
    nameHi: 'फैमिली पैक',
    sort: 120,
  },
  {
    slug: 'series-lari',
    nameEn: 'Series / lari',
    nameTe: 'సిరీస్ / లడీ',
    nameHi: 'सीरीज़ / लड़ी',
    sort: 900,
    isBanned: true,
    bannedReason: 'Joined crackers banned — SC order 2018/2021',
  },
  {
    slug: 'barium-based',
    nameEn: 'Barium-based',
    nameTe: 'బేరియం ఆధారిత',
    nameHi: 'बेरियम वाले',
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
      set: { nameEn: c.nameEn, nameTe: c.nameTe, nameHi: c.nameHi, sort: c.sort },
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
  hi: string,
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
    'इलेक्ट्रिक फुलझड़ी 10 सेमी',
    '10 pcs',
    60,
    'CSIR_NEERI_SWAS',
    'A1',
  ],
  [
    'sparklers',
    'Colour Sparklers 15 cm',
    'కలర్ కాకరపువ్వొత్తులు 15 సెం.మీ',
    'रंगीन फुलझड़ी 15 सेमी',
    '10 pcs',
    90,
    'CSIR_NEERI_SWAS',
    'A1',
  ],
  [
    'sparklers',
    'Green Sparklers 30 cm',
    'గ్రీన్ కాకరపువ్వొత్తులు 30 సెం.మీ',
    'ग्रीन फुलझड़ी 30 सेमी',
    '5 pcs',
    140,
    'CSIR_NEERI_STAR',
    'A2',
  ],
  [
    'flower-pots',
    'Flower Pots Small',
    'చిన్న చిచ్చుబుడ్లు',
    'छोटे अनार',
    '10 pcs',
    180,
    'CSIR_NEERI_SAFAL',
    'B1',
  ],
  [
    'flower-pots',
    'Flower Pots Deluxe',
    'డీలక్స్ చిచ్చుబుడ్లు',
    'डीलक्स अनार',
    '5 pcs',
    320,
    'CSIR_NEERI_SAFAL',
    'B1',
  ],
  [
    'ground-chakkar',
    'Ground Chakkar Big',
    'పెద్ద భూచక్రాలు',
    'बड़ी ज़मीन चकरी',
    '10 pcs',
    150,
    'CSIR_NEERI_SWAS',
    'B2',
  ],
  [
    'ground-chakkar',
    'Ground Chakkar Deluxe',
    'డీలక్స్ భూచక్రాలు',
    'डीलक्स ज़मीन चकरी',
    '10 pcs',
    260,
    'CSIR_NEERI_STAR',
    'B2',
  ],
  [
    'pencils',
    'Colour Pencils',
    'కలర్ పెన్సిళ్లు',
    'रंगीन पेंसिल',
    '10 pcs',
    110,
    'CSIR_NEERI_SWAS',
    'A3',
  ],
  [
    'twinkling-stars',
    'Twinkling Star 1.5 inch',
    'మెరిసే నక్షత్రం 1.5 అంగుళాలు',
    'टिमटिमाता तारा 1.5 इंच',
    '10 pcs',
    80,
    'CSIR_NEERI_SWAS',
    'A3',
  ],
  [
    'rockets',
    'Baby Rockets',
    'చిన్న రాకెట్లు',
    'छोटे रॉकेट',
    '10 pcs',
    240,
    'CSIR_NEERI_STAR',
    'C1',
  ],
  [
    'rockets',
    'Whistling Rockets',
    'విజిల్ రాకెట్లు',
    'सीटी वाले रॉकेट',
    '5 pcs',
    300,
    'CSIR_NEERI_STAR',
    'C1',
  ],
  [
    'aerial-shots',
    'Sky Shot 7',
    'స్కై షాట్ 7',
    'स्काई शॉट 7',
    '1 box',
    450,
    'CSIR_NEERI_SAFAL',
    'C2',
  ],
  [
    'aerial-shots',
    'Colour Rain 12 Shot',
    'కలర్ రెయిన్ 12 షాట్',
    'कलर रेन 12 शॉट',
    '1 box',
    780,
    'CSIR_NEERI_SAFAL',
    'C2',
  ],
  [
    'fountains',
    'Gold Fountain',
    'గోల్డ్ ఫౌంటెన్',
    'गोल्ड फव्वारा',
    '1 pc',
    220,
    'CSIR_NEERI_STAR',
    'B3',
  ],
  [
    'sound-crackers-green',
    'Green Bijili',
    'గ్రీన్ బిజిలీ',
    'ग्रीन बिजली',
    '100 pcs',
    120,
    'CSIR_NEERI_SWAS',
    'D1',
  ],
  [
    'sound-crackers-green',
    'Green Atom Bomb',
    'గ్రీన్ ఆటమ్ బాంబ్',
    'ग्रीन एटम बम',
    '10 pcs',
    200,
    'CSIR_NEERI_SWAS',
    'D1',
  ],
  [
    'kids-safe',
    'Kids Combo Box',
    'పిల్లల కాంబో బాక్స్',
    'बच्चों का कॉम्बो बॉक्स',
    '1 box',
    650,
    'CSIR_NEERI_OTHER',
    'A4',
  ],
  [
    'kids-safe',
    'Family Celebration Box',
    'ఫ్యామిలీ సెలబ్రేషన్ బాక్స్',
    'फैमिली सेलिब्रेशन बॉक्स',
    '1 box',
    1500,
    'CSIR_NEERI_OTHER',
    'A4',
  ],
  [
    'sparklers',
    'Green Sparklers 1 kg',
    'గ్రీన్ కాకరపువ్వొత్తులు 1 కిలో',
    'ग्रीन फुलझड़ियाँ 1 किलो',
    '1 kg pack',
    480,
    'CSIR_NEERI_STAR',
    'A2',
  ],
  [
    'flower-pots',
    'Flower Pots 500 g',
    'చిచ్చుబుడ్లు 500 గ్రా',
    'अनार 500 ग्राम',
    '500 g pack',
    260,
    'CSIR_NEERI_SAFAL',
    'B1',
  ],
];

/** Demo kilo packs. Recommended / Popular are left for the owner to tick. */
const listingTags: Record<string, Partial<Pick<typeof items.$inferInsert, 'weightGrams'>>> = {
  'Green Sparklers 1 kg': { weightGrams: 1000 },
  'Flower Pots 500 g': { weightGrams: 500 },
};

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
  for (const [slug, en, te, hi, pack, rupees, cert, rack] of picked) {
    itemNo++;
    const pricePaise = Math.round((rupees * s.factor) / 5) * 500;
    const values = {
      shopId,
      itemNo,
      categoryId: catId.get(slug)!,
      nameEn: en,
      nameTe: te,
      nameHi: hi,
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
      isRecommended: false,
      isPopular: false,
      // every third product is a certified standard brand (try the Standard only switch)
      isStandard: itemNo % 3 === 0,
      weightGrams: null as number | null,
      ...listingTags[en],
    };
    // Kilo packs are priced from a rate per kg, like the owner's form (the pack price is derived).
    const kilo =
      values.weightGrams != null
        ? resolvePricing({
            saleMode: 'kilo',
            pricePerKgPaise: Math.round((pricePaise * 1000) / values.weightGrams),
            offerPricePerKgPaise:
              values.offerPricePaise != null
                ? Math.round((values.offerPricePaise * 1000) / values.weightGrams)
                : null,
            weightGrams: values.weightGrams,
          })
        : null;
    if (kilo && !kilo.ok) throw new Error(`seed kilo price: ${kilo.message}`);
    Object.assign(values, kilo?.value ?? { saleMode: 'mrp' });
    await db
      .insert(items)
      .values(values)
      .onConflictDoUpdate({ target: [items.shopId, items.itemNo], set: values });
  }
  await db
    .insert(shopPriceVersions)
    .values({ shopId, version: 2 })
    .onConflictDoUpdate({
      target: shopPriceVersions.shopId,
      set: { version: sql`${shopPriceVersions.version} + 1` },
    });
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
  const [slug, en, te, hi, pack, rupees, cert, rack] = catalogue[catalogueIdx]!;
  const values = {
    shopId: pendingShop!.id,
    itemNo: i + 1,
    categoryId: catId.get(slug)!,
    nameEn: en,
    nameTe: te,
    nameHi: hi,
    packDesc: pack,
    pricePaise: rupees * 100,
    greenCert: cert,
    greenRef: `NEERI-${cert.split('_').pop()}-26-9${i}`,
    rackCode: rack,
    barcode: `20990000${String(i + 1).padStart(4, '0')}`,
    barcodeSource: 'store' as const,
  };
  values.barcode += String(ean13CheckDigit(values.barcode));
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

// Demo customer names, printed on pack stickers.
const DEMO_CUSTOMER_NAMES: Record<number, string> = {
  91: 'Priya Sharma',
  92: 'Suresh Reddy',
  99: 'Ravi Kumar',
};

await upsertUser(phone(99), 'customer', DEMO_CUSTOMER_NAMES[99]!);

// ---- Demo orders at SLC01 (mock ₹30 fee; no real money) ----
// +91 90000 00091: placed, waiting for the merchant to confirm.
// +91 90000 00092: packed — QRs below let you try the Express Pickup counter.

const pickupSecret = (n: number) => `DEMXQR${String(n).padStart(19, '0')}A`;
const packSecret = (n: number) => `DEMXPACK${String(n).padStart(18, '0')}`;
const DEMO_PICKUP_SECRET = pickupSecret(92);
const DEMO_PACK_SECRET = packSecret(92);
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
  const customer = await upsertUser(
    phone(n),
    'customer',
    DEMO_CUSTOMER_NAMES[n] ?? `Demo customer ${n - 90}`,
  );
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
            packNo: n - 91, // 92 → 1, 93 → 2, 95 → 4
            packDay: istDate(now),
            customerQrHash: hashSecret(pickupSecret(n)),
            packQrHash: hashSecret(packSecret(n)),
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
      nameHi: l.it.nameHi,
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

// ---- Growth program: agents (gig workers), their shops and payouts ----
const [admin] = await db
  .select()
  .from(users)
  .where(eq(users.phoneE164, phone(1)));
const growth = await seedGrowth(db, {
  phone,
  adminId: admin!.id,
  upsertCustomer: (n, name) => upsertUser(phone(n), 'customer', name),
});

const packCount = await seedPacks(db);

await closeDb();
console.log(`Seeded Diwali Express Pickup demo data.
  Packs & bundles: ${packCount} across SLC01, ANA01, BAL01, DEM01 (compare at /kits/family)
  Shops: SLC01, BAL01, ANA01, DEM01 (live) · SAI01 (licence pending)
  Accounts (OTP 123456 in dev, or one tap in demo mode):
    admin        ${phone(1)}
    shop owner   ${phone(11)} (SLC01)     staff ${phone(12)}   packer ${phone(13)}   cashier ${phone(14)}
    marshal      ${phone(51)} (Gachibowli)
    customer     ${phone(99)}
    customers    ${phone(91)} (order placed)   ${phone(92)} (order packed)
    agent        ${phone(61)} (gig worker: 4 shops, one payout sent, one waiting)
    new agent    ${phone(62)} (waiting for admin approval)
  ${`Agent ${growth.agentCode}${growth.reviewToken ? ` · owner review link /m/review/${growth.reviewToken}` : ''}`}
  Barcodes at SLC01: 891 + item number, e.g. 8910001
  Packed order DEM-092 — pickup QR: ${encodeOrderQr('customer', DEMO_PICKUP_SECRET)}
                         pack sticker: ${encodeOrderQr('pack', DEMO_PACK_SECRET)}`);
