// Release-blocking guardrail checks (SPEC §1): G1, G3, G4.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { BANNED_PAYMENT_PACKAGES, createVisitSchema } from '@pataka/shared';
import { visits } from './db/schema';

const repo = resolve(import.meta.dirname, '..', '..', '..');

function files(dir: string, match: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage', '.pgdata', '.uploads'].includes(name))
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}

describe('G1 — no item lists stored server-side', () => {
  it('migrations and schema have no order/cart/booking item tables', () => {
    const sources = [
      ...files(join(repo, 'apps/api/src/db'), (f) => /\.(sql|ts)$/.test(f)),
      ...files(
        join(repo, 'packages/shared/src'),
        (f) => f.endsWith('.ts') && !f.includes('.test.'),
      ),
    ];
    for (const f of sources) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      for (const banned of ['order_items', 'booking_items', 'cart_items', 'create table "cart"']) {
        expect(text.includes(banned), `${banned} in ${f}`).toBe(false);
      }
    }
  });

  it('the booking body has no items field and rejects extra keys', () => {
    expect(Object.keys(createVisitSchema.shape)).toEqual(['shopShortCode', 'slotId', 'vehicle']);
    expect(
      createVisitSchema.safeParse({
        shopShortCode: 'SLC01',
        slotId: '00000000-0000-4000-8000-000000000000',
        items: [],
      }).success,
    ).toBe(false);
  });
});

describe('G4 — no money on visits', () => {
  it('visits has no amount, total, price or item columns', () => {
    const cols = Object.values(getTableColumns(visits)).map((c) => c.name);
    for (const c of cols) expect(c).not.toMatch(/amount|total|price|paise|item|qty/);
  });
});

describe('G3 — no payment SDKs or UPI links', () => {
  it('no package.json depends on a payment gateway', () => {
    for (const f of files(repo, (p) => p.endsWith('package.json'))) {
      const pkg = JSON.parse(readFileSync(f, 'utf8')) as Record<string, Record<string, string>>;
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      for (const d of deps) {
        for (const banned of BANNED_PAYMENT_PACKAGES) {
          expect(d.toLowerCase().includes(banned), `${d} in ${f}`).toBe(false);
        }
      }
    }
  });

  it('no source file contains a UPI intent link', () => {
    const src = files(
      repo,
      (f) => /\.(ts|tsx|json|html)$/.test(f) && !f.endsWith('guardrails.test.ts'),
    );
    for (const f of src) expect(readFileSync(f, 'utf8').includes('upi://'), f).toBe(false);
  });
});
