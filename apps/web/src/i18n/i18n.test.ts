import { describe, expect, it } from 'vitest';
import en from './en.json';
import te from './te.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n catalogues', () => {
  it('en and te have the same keys', () => {
    expect(keys(te).sort()).toEqual(keys(en).sort());
  });
});
