import { describe, expect, it } from 'vitest';
import { findBannedTerms } from './copy';
import { formatPaise, rupeesToPaise } from './money';

describe('findBannedTerms', () => {
  it.each([
    ['Your order is ready', ['order']],
    ['Reserve online now', ['reserve']],
    ['Booking confirmed!', ['booking confirmed']],
    ['Add to cart', ['cart']],
    ['100% legal', ['100% legal']],
  ])('%s', (text, expected) => {
    expect(findBannedTerms(text)).toEqual(expected);
  });

  it('ignores words that only contain a banned term', () => {
    expect(findBannedTerms('border, cartoon, reorder-free, preserves')).toEqual([]);
  });

  it('allows the legal reference in the mandatory safety notice', () => {
    expect(findBannedTerms('Burst only 8–10 pm, as per Supreme Court orders.')).toEqual([]);
    expect(findBannedTerms('Supreme Court orders. Your order is ready')).toEqual(['order']);
  });

  it('passes approved wording', () => {
    expect(
      findBannedTerms('Plan your list and book a pickup slot. Prices final at the counter.'),
    ).toEqual([]);
  });
});

describe('money', () => {
  it('formats paise as rupees', () => {
    expect(formatPaise(150000)).toBe('₹1,500');
    expect(formatPaise(12050)).toBe('₹120.5');
  });

  it('parses rupee input', () => {
    expect(rupeesToPaise('1,500')).toBe(150000);
    expect(rupeesToPaise('₹120.50')).toBe(12050);
    expect(rupeesToPaise('0')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });
});
