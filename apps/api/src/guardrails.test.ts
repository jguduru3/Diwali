// Release-blocking guardrail checks (CLAUDE.md, SPEC_V3 §2): L1, G3, G4, G11.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BANNED_PAYMENT_PACKAGES,
  PLATFORM_FEE_PAISE,
  encodeOrderQr,
  placeOrderSchema,
} from '@pataka/shared';
import { counterPayments, feePayments, orderLines, orders, shops } from './db/schema';
import { env } from './lib/env';

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

const columns = (t: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(t)).map((c) => (c as { name: string }).name);

describe('L1 — online ordering is off unless switched on', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to off', () => {
    delete process.env.ORDERING_ENABLED;
    expect(env.orderingEnabled()).toBe(false);
  });

  it('the mock fee provider and simulated counter UPI are refused in prod', () => {
    process.env.APP_ENV = 'prod';
    process.env.PAYMENT_PROVIDER = 'mock';
    expect(() => env.paymentProvider()).toThrow();
    expect(() => env.mockPaymentSecret()).toThrow();
    expect(env.mockCounterUpi()).toBe(false);
  });
});

describe('G3 — no payment SDKs; platform takes only its flat fee', () => {
  it('no package.json depends on a payment gateway SDK', () => {
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

  it('our code never builds UPI intent links (the merchant’s YouPI-PG does)', () => {
    const src = files(
      repo,
      (f) => /\.(ts|tsx|json|html)$/.test(f) && !f.endsWith('guardrails.test.ts'),
    );
    for (const f of src) expect(readFileSync(f, 'utf8').includes('upi://'), f).toBe(false);
  });

  it('the fee is flat and fee payments are a separate table from counter payments', () => {
    expect(PLATFORM_FEE_PAISE).toBe(3000);
    expect(columns(feePayments)).toContain('order_id');
    expect(columns(counterPayments)).not.toContain('fee_paise');
  });
});

describe('G4 — no commission or per-sale platform fee', () => {
  it('orders, lines, counter payments and shops carry no commission fields', () => {
    for (const t of [orders, orderLines, counterPayments, shops]) {
      for (const c of columns(t)) {
        expect(c).not.toMatch(/commission|take_rate|platform_share|platform_cut|margin/);
      }
    }
  });
});

describe('G11 — clients send item ids and quantities only', () => {
  it('the place-order body has exactly shopCode and lines[{itemId, qty}]', () => {
    expect(Object.keys(placeOrderSchema.shape)).toEqual(['shopCode', 'lines']);
    const ok = {
      shopCode: 'SLC01',
      lines: [{ itemId: '00000000-0000-4000-8000-000000000001', qty: 1 }],
    };
    expect(placeOrderSchema.safeParse(ok).success).toBe(true);
    for (const extra of [{ totalPaise: 1 }, { status: 'packed' }, { feePaise: 0 }]) {
      expect(placeOrderSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
    expect(
      placeOrderSchema.safeParse({ ...ok, lines: [{ ...ok.lines[0], unitPricePaise: 1 }] }).success,
    ).toBe(false);
  });

  it('pickup and pack QRs are opaque: no phone, price or item data', () => {
    const qr = encodeOrderQr('customer', '0123456789ABCDEFGHJKMNPQRS');
    expect(qr).toMatch(/^DXO1\.[0-9A-Z]{26}$/);
  });
});
