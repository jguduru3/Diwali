import { describe, expect, it } from 'vitest';
import {
  WEIGHT_STEP_GRAMS,
  WEIGHT_TOLERANCE,
  finalTotal,
  formatGrams,
  lineAmount,
  needsCustomer,
  placeOrderSchema,
  withinTolerance,
} from './order';

describe('weight pricing', () => {
  it('prices per-kg lines from grams, rounded to the paisa', () => {
    expect(lineAmount(80000, { grams: 1250 })).toBe(100000); // ₹800/kg × 1.25 kg
    expect(lineAmount(33333, { grams: 333 })).toBe(11100); // 333.33 × 0.333 → 110.999… → ₹111.00
    expect(lineAmount(5000, { qty: 3 })).toBe(15000);
  });

  it('bills picked weight lines at the packed weight', () => {
    expect(
      finalTotal([
        { status: 'picked', unitPricePaise: 80000, pickedQty: 1, packedGrams: 2100 },
        { status: 'picked', unitPricePaise: 1000, pickedQty: 2, packedGrams: null },
        { status: 'weight_proposed', unitPricePaise: 80000, pickedQty: 0, packedGrams: null },
      ]),
    ).toBe(168000 + 2000);
  });

  it('accepts weights within ±10 % of the order', () => {
    expect(WEIGHT_TOLERANCE).toBe(0.1);
    expect(withinTolerance(2000, 2200)).toBe(true);
    expect(withinTolerance(2000, 1800)).toBe(true);
    expect(withinTolerance(2000, 2201)).toBe(false);
    expect(withinTolerance(2000, 1799)).toBe(false);
  });

  it('a weight outside tolerance needs the customer', () => {
    expect(needsCustomer([{ status: 'picked' }, { status: 'weight_proposed' }])).toBe(true);
  });

  it('formats grams for people', () => {
    expect(formatGrams(250)).toBe('250 g');
    expect(formatGrams(1000)).toBe('1 kg');
    expect(formatGrams(1250)).toBe('1.25 kg');
    expect(WEIGHT_STEP_GRAMS).toBe(250);
  });
});

describe('place-order body with weights (G11)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('accepts unit lines, per-kg lines and mix lines', () => {
    expect(
      placeOrderSchema.safeParse({
        shopCode: 'SLC01',
        lines: [
          { itemId: id(1), qty: 2 },
          { itemId: id(2), grams: 1500 },
          { itemId: id(3), grams: 2000, mixItemIds: [id(4), id(5)] },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects weights out of range or off the 50 g grid, and prices', () => {
    const one = (line: object) =>
      placeOrderSchema.safeParse({ shopCode: 'SLC01', lines: [line] }).success;
    expect(one({ itemId: id(2), grams: 0 })).toBe(false);
    expect(one({ itemId: id(2), grams: 60_000 })).toBe(false);
    expect(one({ itemId: id(2), grams: 1234 })).toBe(false);
    expect(one({ itemId: id(2), grams: 1000, pricePaise: 1 })).toBe(false);
    expect(one({ itemId: id(2), qty: 1, grams: 1000 })).toBe(false);
  });
});
