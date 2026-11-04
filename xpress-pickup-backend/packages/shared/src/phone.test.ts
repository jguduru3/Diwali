import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeIndianPhone } from './phone';

describe('normalizeIndianPhone', () => {
  it.each(['9876543210', '98765 43210', '09876543210', '919876543210', '+91 98765-43210'])(
    '%s → +919876543210',
    (input) => {
      expect(normalizeIndianPhone(input)).toBe('+919876543210');
    },
  );

  it.each(['12345', '5876543210', '+1 4155552671', 'abcdefghij', ''])('rejects %s', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });

  it('masks all but the last 4 digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••• •3210');
  });
});
