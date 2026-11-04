import { describe, expect, it } from 'vitest';
import {
  GST_RATE_PERCENT,
  PLATFORM_SAC,
  SUBSCRIPTION_GST_PAISE,
  SUBSCRIPTION_PAISE,
  SUBSCRIPTION_TOTAL_PAISE,
  gstFromInclusive,
  invoiceNumber,
} from './index';

describe('GST on prices that include it (18%, CGST + SGST within Telangana)', () => {
  it('the ₹30 platform fee: ₹25.42 taxable, ₹4.58 GST', () => {
    expect(gstFromInclusive(3000)).toEqual({
      taxablePaise: 2542,
      cgstPaise: 229,
      sgstPaise: 229,
      gstPaise: 458,
      totalPaise: 3000,
    });
  });

  it('the merchant subscription: ₹2,499 including ₹381.20 GST', () => {
    expect(SUBSCRIPTION_TOTAL_PAISE).toBe(249_900);
    expect(gstFromInclusive(249_900)).toEqual({
      taxablePaise: 211_780,
      cgstPaise: 19_060,
      sgstPaise: 19_060,
      gstPaise: 38_120,
      totalPaise: 249_900,
    });
    expect(SUBSCRIPTION_PAISE + SUBSCRIPTION_GST_PAISE).toBe(249_900);
  });

  it('always adds up exactly, splitting an odd paisa onto SGST', () => {
    for (const total of [100, 101, 999, 3001, 12345, 249_901]) {
      const g = gstFromInclusive(total);
      expect(g.taxablePaise + g.gstPaise).toBe(total);
      expect(g.cgstPaise + g.sgstPaise).toBe(g.gstPaise);
      expect(g.sgstPaise - g.cgstPaise).toBeLessThanOrEqual(1);
    }
  });

  it('uses SAC 996211 (fee basis services on retail trade) at 18%', () => {
    expect(PLATFORM_SAC).toBe('996211');
    expect(GST_RATE_PERCENT).toBe(18);
  });
});

describe('invoice numbers', () => {
  it('a series, the financial year and a serial, within the 16 characters GST allows', () => {
    const no = invoiceNumber('XPF', '2026-27', 42);
    expect(no).toBe('XPF/2627/000042');
    expect(no.length).toBeLessThanOrEqual(16);
    expect(invoiceNumber('XPS', '2026-27', 1_000_000)).toBe('XPS/2627/1000000');
  });
});
