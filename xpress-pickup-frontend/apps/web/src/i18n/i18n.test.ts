import { describe, expect, it } from 'vitest';
import en from './en.json';
import te from './te.json';
import hi from './hi.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function values(obj: object, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? values(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );
}

// Text that is the same in every language: brand and payment names, codes, pure placeholders.
const SAME_EVERYWHERE =
  /^(?:[\s\d{}.·–()/#:+-]|UPI|QR|SWAS|STAR|SAFAL|PhonePe|GSTIN|UTR|PAN|TDS|SAC|CGST|SGST|%|Better Analytics Private Limited|\{\{\w+\}\})*$/;

describe('i18n catalogues', () => {
  it('en and te have the same keys', () => {
    expect(keys(te).sort()).toEqual(keys(en).sort());
  });

  it('en and hi have the same keys', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });

  // Switching language replaces the English text; a value copied over unchanged would show
  // English to a Telugu or Hindi reader.
  it.each([
    ['te', te],
    ['hi', hi],
  ])('every %s string is translated, not copied from English', (_lng, catalogue) => {
    const english = new Map(values(en));
    const copied = values(catalogue).filter(
      ([k, v]) =>
        v === english.get(k) &&
        !SAME_EVERYWHERE.test(v.replace(/PhonePe QR \/ UPI|PhonePe QR/g, '')),
    );
    expect(copied).toEqual([]);
  });

  it('keeps every {{placeholder}} of the English string', () => {
    const english = new Map(values(en));
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const catalogue of [te, hi]) {
      for (const [k, v] of values(catalogue)) {
        const base = english.get(k);
        if (base !== undefined) expect([k, vars(v)]).toEqual([k, vars(base)]);
      }
    }
  });
});
