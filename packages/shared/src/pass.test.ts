import { describe, expect, it } from 'vitest';
import {
  PASS_FEE_PAISE,
  PASS_SECRET_LENGTH,
  effectivePassStatus,
  encodePassQr,
  formatPassRef,
  passHolderMask,
  parsePassInput,
  passValidTo,
  scanFlag,
} from './pass';

const SECRET = '0123456789ABCDEFGHJKMNPQRS';

describe('pass QR', () => {
  it('the fee is a flat ₹30', () => {
    expect(PASS_FEE_PAISE).toBe(3000);
  });

  it('encodes with the DXP1 prefix using only QR alphanumeric characters', () => {
    const qr = encodePassQr(SECRET);
    expect(qr).toBe(`DXP1.${SECRET}`);
    expect(qr).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
  });

  it('rejects secrets of the wrong shape', () => {
    expect(() => encodePassQr('SHORT')).toThrow();
    expect(() => encodePassQr(SECRET.replace('0', 'I'))).toThrow();
  });

  it('parses scanned or typed input', () => {
    expect(parsePassInput(`DXP1.${SECRET}`)).toBe(SECRET);
    expect(parsePassInput(SECRET.toLowerCase())).toBe(SECRET);
    expect(parsePassInput('01234 56789-ABCDE FGHJK MNPQR S')).toBe(SECRET);
    expect(parsePassInput(` dxp1.${SECRET} `)).toBe(SECRET);
  });

  it('refuses list QRs, wrong prefixes and bad characters', () => {
    expect(parsePassInput('PP1.-.SLC01.C.3*2')).toBeNull();
    expect(parsePassInput(`XYZ1.${SECRET}`)).toBeNull();
    expect(parsePassInput(SECRET.slice(1))).toBeNull();
    expect(parsePassInput(SECRET.replace('A', 'U'))).toBeNull();
    expect(parsePassInput('')).toBeNull();
  });

  it('secret length gives at least 128 bits', () => {
    expect(PASS_SECRET_LENGTH * 5).toBeGreaterThanOrEqual(128);
  });
});

describe('pass reference and phone masking', () => {
  it('formats a reference in two groups', () => {
    expect(formatPassRef('K7Q2M9AB')).toBe('DXP-K7Q2-M9AB');
  });

  it('shows only the last four digits of the phone (G9)', () => {
    expect(passHolderMask('+919000000099')).toBe('••••••0099');
    expect(passHolderMask('deleted:abc')).toBe('••••••');
  });
});

describe('validity', () => {
  const paid = new Date('2026-10-30T06:00:00Z');

  it('defaults to the end of the season (23:59 IST)', () => {
    expect(passValidTo(paid, '2026-11-20', null).toISOString()).toBe('2026-11-20T18:29:00.000Z');
  });

  it('uses a rolling window when hours are set, capped at season end', () => {
    expect(passValidTo(paid, '2026-11-20', 72).toISOString()).toBe('2026-11-02T06:00:00.000Z');
    expect(passValidTo(paid, '2026-10-31', 72).toISOString()).toBe('2026-10-31T18:29:00.000Z');
  });
});

describe('effective status', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const future = new Date('2026-11-20T18:29:00Z');
  const past = new Date('2026-10-31T00:00:00Z');

  it('active passes past valid_to are expired', () => {
    expect(effectivePassStatus({ status: 'active', validTo: future }, now)).toBe('active');
    expect(effectivePassStatus({ status: 'active', validTo: past }, now)).toBe('expired');
  });

  it('other states are reported as stored', () => {
    for (const status of ['pending_payment', 'revoked', 'refund_pending', 'refunded'] as const) {
      expect(effectivePassStatus({ status, validTo: past }, now)).toBe(status);
    }
  });
});

describe('scan flags (flag, never block)', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it('no flag for a normal day of shop-hopping', () => {
    const recent = [
      { placeKey: 'shop:A', at: ago(240) },
      { placeKey: 'shop:B', at: ago(120) },
      { placeKey: 'shop:C', at: ago(30) },
    ];
    expect(scanFlag(recent, 'shop:D', now)).toBeNull();
  });

  it('flags four different places within an hour', () => {
    const recent = [
      { placeKey: 'shop:A', at: ago(50) },
      { placeKey: 'shop:B', at: ago(20) },
      { placeKey: 'shop:C', at: ago(5) },
    ];
    expect(scanFlag(recent, 'shop:D', now)).toBe('many_places');
  });

  it('flags repeated scans at the same place within ten minutes', () => {
    const recent = [
      { placeKey: 'shop:A', at: ago(8) },
      { placeKey: 'shop:A', at: ago(2) },
    ];
    expect(scanFlag(recent, 'shop:A', now)).toBe('rapid_repeat');
    expect(scanFlag(recent.slice(1), 'shop:A', now)).toBeNull();
  });

  it('flags too many scans in one IST day', () => {
    const recent = Array.from({ length: 19 }, (_, i) => ({
      placeKey: `shop:${i % 3}`,
      at: ago(30 * i + 15),
    }));
    expect(scanFlag(recent, 'shop:0', now)).toBe('too_many_today');
  });
});
