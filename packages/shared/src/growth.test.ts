import { describe, expect, it } from 'vitest';
import {
  canOnboard,
  financialYear,
  generateCode,
  isValidPan,
  isValidUpiId,
  maxRedeemable,
  previousWeek,
  SUBSCRIPTION_GST_PAISE,
  SUBSCRIPTION_PAISE,
  tdsFor,
  withdrawalCheck,
} from './growth';

describe('codes', () => {
  it('prefix plus 6 Crockford characters, never I, L, O or U', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode('DXA');
      expect(c).toMatch(/^DXA-[0-9A-HJKMNP-TV-Z]{6}$/);
    }
    expect(generateCode('DXI', () => 0)).toBe('DXI-000000');
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

describe('withdrawals', () => {
  const base = {
    balancePaise: 500_000,
    amountPaise: 100_000,
    todayPaise: 0,
    fyEarnedPaise: 0,
    hasPan: false,
    frozen: false,
  };
  it('allows any number a day up to ₹2,000 in total', () => {
    expect(withdrawalCheck(base)).toEqual({ ok: true });
    expect(withdrawalCheck({ ...base, todayPaise: 150_000, amountPaise: 50_000 })).toEqual({
      ok: true,
    });
    expect(withdrawalCheck({ ...base, todayPaise: 150_000, amountPaise: 50_001 })).toMatchObject({
      ok: false,
      code: 'daily_cap',
    });
  });
  it('refuses more than the balance, a frozen wallet and a zero amount', () => {
    expect(withdrawalCheck({ ...base, amountPaise: 500_001 })).toMatchObject({ code: 'balance' });
    expect(withdrawalCheck({ ...base, frozen: true })).toMatchObject({ code: 'frozen' });
    expect(withdrawalCheck({ ...base, amountPaise: 0 })).toMatchObject({ code: 'amount' });
  });
  it('pauses at ₹20,000 earned in the year until a PAN is given', () => {
    expect(withdrawalCheck({ ...base, fyEarnedPaise: 1_999_999 })).toEqual({ ok: true });
    expect(withdrawalCheck({ ...base, fyEarnedPaise: 2_000_000 })).toMatchObject({
      code: 'pan_required',
    });
    expect(withdrawalCheck({ ...base, fyEarnedPaise: 2_000_000, hasPan: true })).toEqual({
      ok: true,
    });
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
    // capped by the withdrawal itself
    expect(tdsFor({ fyEarnedPaise: 3_000_000, taxedBasePaise: 0, amountPaise: 100_000 })).toEqual({
      tdsPaise: 2_000,
      basePaise: 100_000,
    });
  });
});

describe('credit at the counter', () => {
  it('never more than the bill or the balance', () => {
    expect(maxRedeemable(25_000, 1_000)).toBe(1_000);
    expect(maxRedeemable(800, 1_000)).toBe(800);
    expect(maxRedeemable(25_000, -50)).toBe(0);
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

describe('weekly settlement period', () => {
  it('is the previous Monday to Sunday in IST', () => {
    expect(previousWeek(new Date('2026-11-09T03:30:00+05:30'))).toEqual({
      start: '2026-11-02',
      end: '2026-11-08',
    });
    expect(previousWeek(new Date('2026-11-12T10:00:00+05:30'))).toEqual({
      start: '2026-11-02',
      end: '2026-11-08',
    });
  });
});
