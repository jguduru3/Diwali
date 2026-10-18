import { describe, expect, it } from 'vitest';
import { addDays, haversineKm, istDate, istInstant, istTime } from './time';

describe('IST helpers', () => {
  it('converts wall-clock IST to UTC instants', () => {
    expect(istInstant('2026-11-08', '20:00').toISOString()).toBe('2026-11-08T14:30:00.000Z');
  });

  it('gives the IST date even when UTC is still the previous day', () => {
    const at = new Date('2026-11-07T19:00:00Z'); // 00:30 IST on the 8th
    expect(istDate(at)).toBe('2026-11-08');
    expect(istTime(at)).toBe('00:30');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('haversineKm', () => {
  it('Gachibowli → Madhapur is about 4–5 km', () => {
    const d = haversineKm({ lat: 17.4401, lng: 78.3489 }, { lat: 17.4483, lng: 78.3915 });
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(5);
  });
});
