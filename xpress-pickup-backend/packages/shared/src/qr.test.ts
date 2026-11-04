import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodePlan, encodePlan, MAX_PLAN_LINES, normalizeLines, VISIT_CODE_ALPHABET } from './qr';

const QR_ALNUM = /^[0-9A-Z $%*+\-./:]*$/;

describe('encodePlan', () => {
  it('matches the spec example', () => {
    expect(
      encodePlan({
        visitCode: 'K7Q2M9',
        shopCode: 'SLC01',
        priceVersion: 12,
        lines: [
          { itemNo: 3, qty: 2 },
          { itemNo: 7, qty: 1 },
          { itemNo: 46, qty: 4 },
        ],
      }),
    ).toBe('PP1.K7Q2M9.SLC01.C.3*2-7*1-1A*4');
  });

  it('encodes walk-in lists with "-" as the visit code', () => {
    expect(
      encodePlan({
        visitCode: null,
        shopCode: 'SLC01',
        priceVersion: 12,
        lines: [{ itemNo: 3, qty: 2 }],
      }),
    ).toBe('PP1.-.SLC01.C.3*2');
  });

  it('merges repeated items and drops zero quantities', () => {
    expect(
      normalizeLines([
        { itemNo: 7, qty: 1 },
        { itemNo: 3, qty: 2 },
        { itemNo: 7, qty: 2 },
        { itemNo: 9, qty: 0 },
      ]),
    ).toEqual([
      { itemNo: 3, qty: 2 },
      { itemNo: 7, qty: 3 },
    ]);
  });

  it('rejects too many lines', () => {
    const lines = Array.from({ length: MAX_PLAN_LINES + 1 }, (_, i) => ({ itemNo: i + 1, qty: 1 }));
    expect(() =>
      encodePlan({ visitCode: null, shopCode: 'SLC01', priceVersion: 1, lines }),
    ).toThrow();
  });
});

describe('decodePlan', () => {
  it('decodes the spec example', () => {
    expect(decodePlan('PP1.K7Q2M9.SLC01.C.3*2-7*1-1A*4')).toEqual({
      ok: true,
      value: {
        visitCode: 'K7Q2M9',
        shopCode: 'SLC01',
        priceVersion: 12,
        lines: [
          { itemNo: 3, qty: 2 },
          { itemNo: 7, qty: 1 },
          { itemNo: 46, qty: 4 },
        ],
      },
    });
  });

  it('accepts an empty list', () => {
    const r = decodePlan('PP1.K7Q2M9.SLC01.1.');
    expect(r.ok && r.value.lines).toEqual([]);
  });

  it.each([
    ['XX1.K7Q2M9.SLC01.C.3*2', 'bad_prefix'],
    ['PP1.K7Q2M9.SLC01.C', 'bad_format'],
    ['PP1.K7Q2MI.SLC01.C.3*2', 'bad_visit_code'],
    ['PP1.K7Q2M9.SL.C.3*2', 'bad_shop_code'],
    ['PP1.K7Q2M9.SLC01.0.3*2', 'bad_price_version'],
    ['PP1.K7Q2M9.SLC01.C.3*0', 'bad_qty'],
    ['PP1.K7Q2M9.SLC01.C.3*2S', 'bad_qty'], // 2S = 100,
    ['PP1.K7Q2M9.SLC01.C.3-2', 'bad_line'],
    ['PP1.K7Q2M9.SLC01.C.3*2-3*1', 'duplicate_item'],
    ['PP1.K7Q2M9.SLC01.C.3#2', 'bad_line'],
  ])('%s → %s', (text, error) => {
    expect(decodePlan(text)).toEqual({ ok: false, error });
  });

  it('rejects more than 40 lines', () => {
    const items = Array.from({ length: 41 }, (_, i) => `${(i + 1).toString(36)}*1`).join('-');
    expect(decodePlan(`PP1.-.SLC01.1.${items}`)).toEqual({ ok: false, error: 'too_many_lines' });
  });
});

describe('round trip (property)', () => {
  const visitCode = fc.option(
    fc.string({ unit: fc.constantFrom(...VISIT_CODE_ALPHABET), minLength: 6, maxLength: 6 }),
    { nil: null },
  );
  const shopCode = fc.string({
    unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
    minLength: 3,
    maxLength: 6,
  });
  const lines = fc.uniqueArray(
    fc.record({ itemNo: fc.integer({ min: 1, max: 5000 }), qty: fc.integer({ min: 1, max: 99 }) }),
    { maxLength: MAX_PLAN_LINES, selector: (l) => l.itemNo },
  );

  it('decode(encode(plan)) gives the same plan, using QR alphanumeric characters only', () => {
    fc.assert(
      fc.property(
        visitCode,
        shopCode,
        fc.integer({ min: 1, max: 100_000 }),
        lines,
        (v, s, p, l) => {
          const text = encodePlan({ visitCode: v, shopCode: s, priceVersion: p, lines: l });
          expect(text).toMatch(QR_ALNUM);
          expect(decodePlan(text)).toEqual({
            ok: true,
            value: { visitCode: v, shopCode: s, priceVersion: p, lines: normalizeLines(l) },
          });
        },
      ),
    );
  });
});
