import { describe, expect, it } from 'vitest';
import { findBannedTerms } from './copy';
import { formatPaise, rupeesToPaise } from './money';

describe('findBannedTerms', () => {
  it.each([
    ['Buy now', ['buy now']],
    ['Booking confirmed!', ['booking confirmed']],
    ['Free home delivery', ['delivery']],
    ['We deliver to you', ['deliver']],
    ['100% legal', ['100% legal']],
  ])('%s', (text, expected) => {
    expect(findBannedTerms(text)).toEqual(expected);
  });

  it('ignores words that only contain a banned term', () => {
    expect(findBannedTerms('deliverable-free, nowbuy, legalese')).toEqual([]);
  });

  it('allows the legal reference in the mandatory safety notice', () => {
    expect(findBannedTerms('Burst only 8–10 pm, as per Supreme Court orders.')).toEqual([]);
    expect(findBannedTerms('Supreme Court orders. Delivery today')).toEqual(['delivery']);
  });

  it('passes approved wording', () => {
    expect(
      findBannedTerms('Place your order, collect it at the Express Pickup counter and pay there.'),
    ).toEqual([]);
  });
});

describe('money', () => {
  it('formats paise as rupees', () => {
    expect(formatPaise(150000)).toBe('₹1,500');
    // paise always as two digits, as on a bill or tax invoice
    expect(formatPaise(12050)).toBe('₹120.50');
    expect(formatPaise(38120)).toBe('₹381.20');
    expect(formatPaise(3000)).toBe('₹30');
  });

  it('parses rupee input', () => {
    expect(rupeesToPaise('1,500')).toBe(150000);
    expect(rupeesToPaise('₹120.50')).toBe(12050);
    expect(rupeesToPaise('0')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });
});
