import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/client';
import { isValidEan13 } from '@pataka/shared';
import { readMigrations, runMigrations } from '../src/db/migrate';

const folder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

describe('0013: sale mode, automatic barcodes and documents on an existing database', () => {
  it('turns old kilo packs into kilo sales and gives every product a store barcode', async () => {
    const pool = getPool();
    const m = readMigrations(folder).find((x) => x.tag === '0013_sale_mode_documents')!;
    // A database from before 0013: no sale-mode or barcode rules yet.
    await pool.query('alter table items drop constraint items_sale_mode_fields');
    await pool.query('alter table items drop constraint items_barcode_present');
    const { rows: shop } = await pool.query(
      `insert into shops (short_code, name, area) values ('OLD01', 'Old Shop', 'Gachibowli') returning id`,
    );
    const { rows: cat } = await pool.query(
      `insert into categories (slug, name_en) values ('old-cat', 'Old') returning id`,
    );
    const add = (no: number, extra: string, values: unknown[]) =>
      pool.query(
        `insert into items (shop_id, item_no, category_id, name_en, price_paise, green_cert, green_ref${extra})
         values ($1, $2, $3, 'Old item', $4, 'CSIR_NEERI_SWAS', 'R-1'${values
           .slice(1)
           .map((_, i) => `, $${i + 5}`)
           .join('')})`,
        [shop[0].id, no, cat[0].id, ...values],
      );
    await add(1, ', weight_grams, offer_price_paise', [26000, 500, 24000]); // old kilo pack
    await add(2, ', barcode', [10000, '8901234567890']); // box barcode
    await add(3, '', [5000]); // no barcode

    for (const stmt of m.sql.split('--> statement-breakpoint')) {
      if (stmt.trim()) await pool.query(stmt);
    }

    const { rows } = await pool.query(
      `select item_no, sale_mode, price_paise, price_per_kg_paise, offer_price_per_kg_paise,
              weight_grams, barcode, barcode_source
         from items where shop_id = $1 order by item_no`,
      [shop[0].id],
    );
    expect(rows[0]).toMatchObject({
      sale_mode: 'kilo',
      price_paise: 26000, // the pack price customers saw stays the same
      price_per_kg_paise: 52000,
      offer_price_per_kg_paise: 48000,
      weight_grams: 500,
      barcode_source: 'store',
    });
    expect(rows[1]).toMatchObject({
      sale_mode: 'mrp',
      barcode: '8901234567890',
      barcode_source: 'box',
    });
    expect(rows[2]).toMatchObject({ sale_mode: 'mrp', barcode_source: 'store' });
    for (const r of [rows[0], rows[2]]) {
      expect(r.barcode).toMatch(/^20\d{11}$/);
      expect(isValidEan13(r.barcode)).toBe(true);
    }
    // the rules are in force again afterwards
    await expect(
      pool.query(`update items set barcode = null where shop_id = $1 and item_no = 3`, [
        shop[0].id,
      ]),
    ).rejects.toMatchObject({ constraint: 'items_barcode_present' });
  });
});

describe('db:migrate on a database from before a migration was renumbered', () => {
  it('applies the migration Drizzle would skip and records it', async () => {
    const pool = getPool();
    const standard = readMigrations(folder).find((m) => m.tag === '0009_item_standard')!;
    // The state a teammate's database is in: a later migration recorded, this one never run.
    await pool.query('alter table items drop column is_standard');
    await pool.query('delete from drizzle.__drizzle_migrations where hash = $1', [standard.hash]);

    const log: string[] = [];
    await runMigrations(pool, folder, (l) => log.push(l));

    const col = await pool.query(
      `select 1 from information_schema.columns where table_name = 'items' and column_name = 'is_standard'`,
    );
    expect(col.rowCount).toBe(1);
    const rec = await pool.query(
      'select created_at from drizzle.__drizzle_migrations where hash = $1',
      [standard.hash],
    );
    expect(Number(rec.rows[0].created_at)).toBe(standard.when);
    expect(log).toEqual([expect.stringContaining('0009_item_standard')]);

    // A second run has nothing left to do.
    const again: string[] = [];
    await runMigrations(pool, folder, (l) => again.push(l));
    expect(again).toEqual([]);
  });
});
