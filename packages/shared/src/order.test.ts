import { describe, expect, it } from 'vitest';
import {
  CONFIRM_WINDOW_HOURS,
  PLATFORM_FEE_PAISE,
  canTransition,
  confirmBy,
  effectivePrice,
  encodeOrderQr,
  feeOutcome,
  finalTotal,
  formatOrderCode,
  needsCustomer,
  parseOrderQr,
  placeOrderSchema,
  readyToPack,
  staffPhoneMask,
} from './order';

const SECRET = '0123456789ABCDEFGHJKMNPQRS';

describe('platform fee rules', () => {
  it('is a flat ₹30 with a 3-day confirmation window', () => {
    expect(PLATFORM_FEE_PAISE).toBe(3000);
    expect(CONFIRM_WINDOW_HOURS).toBe(72);
    expect(confirmBy(new Date('2026-10-30T06:00:00Z')).toISOString()).toBe(
      '2026-11-02T06:00:00.000Z',
    );
  });

  it('refunds when never confirmed, rejected, expired or cancelled before confirmation', () => {
    expect(feeOutcome({ status: 'expired', confirmedAt: null })).toBe('refund');
    expect(feeOutcome({ status: 'rejected', confirmedAt: null })).toBe('refund');
    expect(feeOutcome({ status: 'cancelled', confirmedAt: null })).toBe('refund');
  });

  it('keeps the fee once the merchant confirmed', () => {
    const at = new Date();
    expect(feeOutcome({ status: 'cancelled', confirmedAt: at })).toBe('keep');
    expect(feeOutcome({ status: 'completed', confirmedAt: at })).toBe('keep');
    expect(feeOutcome({ status: 'packing', confirmedAt: at })).toBe('keep');
  });

  it('is undecided while waiting for the merchant', () => {
    expect(feeOutcome({ status: 'placed', confirmedAt: null })).toBe('pending');
    expect(feeOutcome({ status: 'fee_pending', confirmedAt: null })).toBe('none');
  });
});

describe('order state machine (server-enforced)', () => {
  it('allows the happy path', () => {
    const path = ['fee_pending', 'placed', 'confirmed', 'packing', 'packed', 'completed'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('allows customer decisions during packing', () => {
    expect(canTransition('packing', 'awaiting_customer')).toBe(true);
    expect(canTransition('awaiting_customer', 'packing')).toBe(true);
  });

  it('refuses skipping steps and leaving final states', () => {
    expect(canTransition('placed', 'packed')).toBe(false);
    expect(canTransition('fee_pending', 'confirmed')).toBe(false);
    expect(canTransition('confirmed', 'completed')).toBe(false);
    expect(canTransition('awaiting_customer', 'packed')).toBe(false);
    for (const end of ['completed', 'cancelled', 'rejected', 'expired'] as const) {
      expect(canTransition(end, 'placed')).toBe(false);
      expect(canTransition(end, 'cancelled')).toBe(false);
    }
  });

  it('only waiting orders can be rejected or expire', () => {
    expect(canTransition('placed', 'rejected')).toBe(true);
    expect(canTransition('placed', 'expired')).toBe(true);
    expect(canTransition('confirmed', 'expired')).toBe(false);
    expect(canTransition('packed', 'rejected')).toBe(false);
  });
});

describe('pricing', () => {
  const now = new Date('2026-11-01T00:00:00Z');

  it('uses the offer price while the offer runs', () => {
    expect(effectivePrice({ pricePaise: 50000, offerPricePaise: 42000, offerEndsAt: null }, now)).toBe(42000);
    expect(
      effectivePrice(
        { pricePaise: 50000, offerPricePaise: 42000, offerEndsAt: new Date('2026-11-05T00:00:00Z') },
        now,
      ),
    ).toBe(42000);
  });

  it('falls back to the price after the offer ends or if the offer is not lower', () => {
    expect(
      effectivePrice(
        { pricePaise: 50000, offerPricePaise: 42000, offerEndsAt: new Date('2026-10-31T00:00:00Z') },
        now,
      ),
    ).toBe(50000);
    expect(effectivePrice({ pricePaise: 50000, offerPricePaise: 60000, offerEndsAt: null }, now)).toBe(50000);
    expect(effectivePrice({ pricePaise: 50000, offerPricePaise: null, offerEndsAt: null }, now)).toBe(50000);
  });

  it('bills only picked lines', () => {
    expect(
      finalTotal([
        { status: 'picked', unitPricePaise: 1000, pickedQty: 2 },
        { status: 'removed', unitPricePaise: 5000, pickedQty: 0 },
        { status: 'replaced', unitPricePaise: 7000, pickedQty: 0 },
        { status: 'picked', unitPricePaise: 250, pickedQty: 4 },
      ]),
    ).toBe(3000);
  });
});

describe('packing progress', () => {
  it('needs the customer while an out-of-stock or alternative decision is open', () => {
    expect(needsCustomer([{ status: 'picked' }, { status: 'out_of_stock' }])).toBe(true);
    expect(needsCustomer([{ status: 'alternate_proposed' }])).toBe(true);
    expect(needsCustomer([{ status: 'picked' }, { status: 'removed' }])).toBe(false);
  });

  it('is ready to pack when every line is resolved and something was picked', () => {
    expect(readyToPack([{ status: 'picked' }, { status: 'removed' }, { status: 'replaced' }])).toBe(true);
    expect(readyToPack([{ status: 'picked' }, { status: 'pending' }])).toBe(false);
    expect(readyToPack([{ status: 'removed' }])).toBe(false);
    expect(readyToPack([{ status: 'picked' }, { status: 'alternate_proposed' }])).toBe(false);
  });
});

describe('pickup and pack QR codes', () => {
  it('encodes each kind with its prefix, QR-alphanumeric only', () => {
    expect(encodeOrderQr('customer', SECRET)).toBe(`DXO1.${SECRET}`);
    expect(encodeOrderQr('pack', SECRET)).toBe(`DXK1.${SECRET}`);
    expect(encodeOrderQr('pack', SECRET)).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(() => encodeOrderQr('customer', 'SHORT')).toThrow();
  });

  it('parses scanned or typed codes and tells the kinds apart', () => {
    expect(parseOrderQr(`DXO1.${SECRET}`)).toEqual({ kind: 'customer', secret: SECRET });
    expect(parseOrderQr(` dxk1.${SECRET.toLowerCase()} `)).toEqual({ kind: 'pack', secret: SECRET });
    expect(parseOrderQr(SECRET)).toBeNull();
    expect(parseOrderQr('PP1.-.SLC01.C.3*2')).toBeNull();
    expect(parseOrderQr(`DXO1.${SECRET.replace('A', 'U')}`)).toBeNull();
  });

  it('formats order codes and masks phones for staff', () => {
    expect(formatOrderCode('K7Q2M9')).toBe('K7Q-2M9');
    expect(staffPhoneMask('+919000000099')).toBe('••••••0099');
    expect(staffPhoneMask('deleted:x')).toBe('••••••');
  });
});

describe('place-order body (G11)', () => {
  const ok = {
    shopCode: 'SLC01',
    lines: [{ itemId: '00000000-0000-4000-8000-000000000001', qty: 2 }],
  };

  it('accepts item ids and quantities only', () => {
    expect(placeOrderSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects client prices, totals, statuses and extra keys', () => {
    expect(placeOrderSchema.safeParse({ ...ok, total: 1 }).success).toBe(false);
    expect(
      placeOrderSchema.safeParse({ ...ok, lines: [{ ...ok.lines[0], pricePaise: 1 }] }).success,
    ).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, status: 'packed' }).success).toBe(false);
  });

  it('limits quantities and line count', () => {
    expect(placeOrderSchema.safeParse({ ...ok, lines: [{ ...ok.lines[0], qty: 0 }] }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, lines: [{ ...ok.lines[0], qty: 100 }] }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    const many = Array.from({ length: 41 }, (_, i) => ({
      itemId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      qty: 1,
    }));
    expect(placeOrderSchema.safeParse({ ...ok, lines: many }).success).toBe(false);
  });

  it('rejects the same item twice', () => {
    expect(placeOrderSchema.safeParse({ ...ok, lines: [ok.lines[0], ok.lines[0]] }).success).toBe(false);
  });
});
