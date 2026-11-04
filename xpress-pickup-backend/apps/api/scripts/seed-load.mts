// Load-test data: many listed merchants, each with a full price list, and many customers.
// For local and staging databases only — refused when APP_ENV=prod.
//   pnpm --filter api seed:load -- --shops 3000 --items 15 --customers 3000
// Writes .loadtest/fixtures.json (shop codes, item ids, customer session tokens) for
// scripts/loadtest.mjs and loadtest/k6-peak.js. Run `pnpm db:seed` afterwards to restore demo data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client';
import { signSession } from '../src/lib/auth';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();

if (process.env.APP_ENV === 'prod') {
  console.error('seed:load refuses to run against production (APP_ENV=prod).');
  process.exit(1);
}

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isInteger(v) || v < 1) throw new Error(`--${name} must be a positive integer`);
  return v;
};
const SHOPS = arg('shops', 3000);
const ITEMS = arg('items', 15);
const CUSTOMERS = arg('customers', 3000);

const AREAS = [
  'Gachibowli',
  'Madhapur',
  'Kondapur',
  'Kukatpally',
  'Miyapur',
  'Ameerpet',
  'Begumpet',
  'Secunderabad',
  'Uppal',
  'LB Nagar',
  'Dilsukhnagar',
  'Mehdipatnam',
  'Tolichowki',
  'Banjara Hills',
  'Jubilee Hills',
  'Manikonda',
  'Narsingi',
  'Kompally',
  'Bachupally',
  'Nizampet',
  'Habsiguda',
  'Tarnaka',
  'Malkajgiri',
  'Alwal',
  'ECIL',
  'Attapur',
  'Shamshabad',
  'Chandanagar',
  'Lingampally',
  'Hitec City',
];

const db = getDb();
const started = Date.now();

const [cats] = await Promise.all([
  db.execute<{ id: string }>(
    sql`select id from categories where not is_banned order by sort limit 6`,
  ),
]);
if (!cats.rows.length) {
  console.error('No categories: run `pnpm db:seed` first.');
  process.exit(1);
}
const catIds = cats.rows.map((r) => r.id);

await db.transaction(async (tx) => {
  // Shops L00001… with a verified, in-date licence and opening hours; spread over 30 areas.
  await tx.execute(sql`
    insert into shops (short_code, name, area, address, lat, lng, is_live, open_from, open_to)
    select 'L' || lpad(g::text, 5, '0'),
           'Load Test Crackers ' || g,
           (string_to_array(${AREAS.join('|')}, '|'))[1 + (g % ${AREAS.length})],
           'Stall ' || g,
           17.30 + (g % 97) * 0.004,
           78.30 + (g % 89) * 0.004,
           true, '09:00', '23:00'
    from generate_series(1, ${SHOPS}) g
    on conflict (short_code) do nothing`);
  await tx.execute(sql`
    insert into shop_licences (shop_id, licence_no, licence_type, issued_by, valid_from, valid_to,
                               image_blob_path, status, verified_at)
    select s.id, 'LE5/LOAD/' || s.short_code, 'LE-5', 'Load test', current_date - 30,
           current_date + 60, 'seed/demo-licence.png', 'verified', now()
    from shops s
    where s.short_code like 'L_____'
      and not exists (select 1 from shop_licences l where l.shop_id = s.id)`);
  // A price list per shop: a mix of MRP and kilo sales, every product with a store barcode.
  await tx.execute(sql`
    insert into items (shop_id, item_no, category_id, name_en, pack_desc, price_paise,
                       offer_price_paise, green_cert, green_ref, barcode, barcode_source,
                       stock_qty, sale_mode, weight_grams, price_per_kg_paise)
    select s.id, n, (string_to_array(${catIds.join(',')}, ',')::uuid[])[1 + (n % ${catIds.length})],
           'Load item ' || n, case when n % 5 = 0 then null else '10 pcs' end,
           case when n % 5 = 0 then 26000 else 5000 + n * 1000 end,
           case when n % 4 = 1 and n % 5 <> 0 then 4000 + n * 1000 end,
           'CSIR_NEERI_SWAS', 'NEERI-LOAD-' || n, pp_store_barcode(), 'store',
           case when n % 7 = 0 then 100000 end,
           case when n % 5 = 0 then 'kilo'::sale_mode else 'mrp'::sale_mode end,
           case when n % 5 = 0 then 500 end,
           case when n % 5 = 0 then 52000 end
    from shops s cross join generate_series(1, ${ITEMS}) n
    where s.short_code like 'L_____'
    on conflict (shop_id, item_no) do nothing`);
  await tx.execute(sql`
    insert into shop_price_versions (shop_id, version)
    select id, 2 from shops where short_code like 'L_____'
    on conflict (shop_id) do nothing`);
  // Customers +91 8xxxxxxxxx (outside the demo +91 90000 range).
  await tx.execute(sql`
    insert into users (phone_e164, role, display_name)
    select '+918' || lpad(g::text, 9, '0'), 'customer', 'Load customer ' || g
    from generate_series(1, ${CUSTOMERS}) g
    on conflict (phone_e164) do nothing`);
});

const shops = await db.execute<{ code: string; items: string[] }>(sql`
  select s.short_code as code, array_agg(i.id order by i.item_no) as items
  from shops s join items i on i.shop_id = s.id
  where s.short_code like 'L_____' and i.removed_at is null and i.stock_qty is null
  group by s.short_code order by s.short_code`);
const customers = await db.execute<{ id: string; token_version: number }>(sql`
  select id, token_version from users where phone_e164 like '+918%' and role = 'customer'
  order by phone_e164 limit ${CUSTOMERS}`);
const sessions = await Promise.all(
  customers.rows.map(
    async (u) =>
      (await signSession({ id: u.id, role: 'customer', tokenVersion: u.token_version })).token,
  ),
);
const areas = (
  await db.execute<{ area: string }>(
    sql`select distinct area from shops where short_code like 'L_____'`,
  )
).rows.map((r) => r.area);

const out = resolve(import.meta.dirname, '../../../.loadtest/fixtures.json');
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ shops: shops.rows, sessions, areas, createdAt: new Date().toISOString() }),
);
console.log(
  `seed:load: ${shops.rows.length} shops × ${ITEMS} items, ${sessions.length} customers in ${
    (Date.now() - started) / 1000
  }s → ${out}`,
);
await closeDb();
