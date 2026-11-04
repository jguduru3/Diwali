import { describe, expect, it } from 'vitest';
import {
  canOnboard,
  financialYear,
  generateCode,
  isValidPan,
  isValidUpiId,
  payoutBlock,
  PAN_PROMPT_PAISE,
  panPrompt,
  SUBSCRIPTION_GST_PAISE,
  SUBSCRIPTION_PAISE,
  tdsFor,
} from './growth';

describe('codes', () => {
  it('prefix plus 6 Crockford characters, never I, L, O or U', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode('DXA');
      expect(c).toMatch(/^DXA-[0-9A-HJKMNP-TV-Z]{6}$/);
    }
    expect(generateCode('DXA', () => 0)).toBe('DXA-000000');
  });
});

describe('subscription', () => {
  it('is ₹1,999 + ₹360 GST', () => {
    expect(SUBSCRIPTION_PAISE + SUBSCRIPTION_GST_PAISE).toBe(235_900);
  });
});

describe('financial year (IST, April to March)', () => {
  it('names the year', () => {
    expect(financialYear(new Date('2026-11-03T10:00:00+05:30'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T23:59:00+05:30'))).toBe('2026-27');
    expect(financialYear(new Date('2027-04-01T00:00:00+05:30'))).toBe('2027-28');
  });
});

describe('payouts and the PAN gate', () => {
  it('pays freely below ₹20,000 earned in the year', () => {
    expect(payoutBlock({ fyEarnedPaise: 1_999_999, hasPan: false })).toBeNull();
  });
  it('holds a payout from ₹20,000 earned in the year until a PAN is on file', () => {
    expect(payoutBlock({ fyEarnedPaise: 2_000_000, hasPan: false })).toBe('pan_required');
    expect(payoutBlock({ fyEarnedPaise: 2_000_000, hasPan: true })).toBeNull();
  });
  it('asks for the PAN from ₹18,000', () => {
    expect(PAN_PROMPT_PAISE).toBe(1_800_000);
    expect(panPrompt({ fyEarnedPaise: 1_799_999, hasPan: false })).toBe(false);
    expect(panPrompt({ fyEarnedPaise: 1_800_000, hasPan: false })).toBe(true);
    expect(panPrompt({ fyEarnedPaise: 1_800_000, hasPan: true })).toBe(false);
  });
});

describe('TDS (2% above ₹20,000 earned in the year)', () => {
  it('nothing below the threshold', () => {
    expect(tdsFor({ fyEarnedPaise: 1_900_000, taxedBasePaise: 0, amountPaise: 100_000 })).toEqual({
      tdsPaise: 0,
      basePaise: 0,
    });
  });
  it('only the excess over the threshold, once', () => {
    // earned ₹20,500: ₹500 is above the threshold
    expect(tdsFor({ fyEarnedPaise: 2_050_000, taxedBasePaise: 0, amountPaise: 200_000 })).toEqual({
      tdsPaise: 1_000,
      basePaise: 50_000,
    });
    // the same ₹500 is not taxed again
    expect(
      tdsFor({ fyEarnedPaise: 2_050_000, taxedBasePaise: 50_000, amountPaise: 200_000 }),
    ).toEqual({ tdsPaise: 0, basePaise: 0 });
    // capped by the payout itself
    expect(tdsFor({ fyEarnedPaise: 3_000_000, taxedBasePaise: 0, amountPaise: 100_000 })).toEqual({
      tdsPaise: 2_000,
      basePaise: 100_000,
    });
  });
});

describe('merchant onboarding states', () => {
  it('follows draft → consented → setup → review → approved → live', () => {
    expect(canOnboard('draft', 'consented')).toBe(true);
    expect(canOnboard('consented', 'setup')).toBe(true);
    expect(canOnboard('setup', 'review')).toBe(true);
    expect(canOnboard('review', 'setup')).toBe(true); // changes requested
    expect(canOnboard('review', 'approved')).toBe(true);
    expect(canOnboard('approved', 'live')).toBe(true);
    expect(canOnboard('live', 'setup')).toBe(true); // licence failed
    expect(canOnboard('draft', 'review')).toBe(false);
    expect(canOnboard('draft', 'approved')).toBe(false);
    expect(canOnboard('closed', 'setup')).toBe(false);
    expect(canOnboard('setup', 'closed')).toBe(true);
  });
});

describe('UPI ID and PAN', () => {
  it('validates their shape', () => {
    expect(isValidUpiId('ramesh.k@okhdfcbank')).toBe(true);
    expect(isValidUpiId('9876543210@ybl')).toBe(true);
    expect(isValidUpiId('no-at-sign')).toBe(false);
    expect(isValidPan('ABCDE1234F')).toBe(true);
    expect(isValidPan('ABCD1234F')).toBe(false);
  });
});
