import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readMigrations, skippedMigrations, type Migration } from './migrate';

const m = (tag: string, when: number): Migration => ({ idx: 0, tag, when, hash: tag, sql: '' });

describe('skippedMigrations', () => {
  const all = [m('0007', 700), m('0008_a', 800), m('0009_b', 900), m('0010_c', 1000)];

  it('finds a migration renumbered behind one the database already ran', () => {
    // This database ran another branch's 0009 before the merge put 0008_a ahead of it.
    const recorded = [
      { hash: '0007', createdAt: 700 },
      { hash: '0009_b', createdAt: 900 },
    ];
    expect(skippedMigrations(all, recorded).map((x) => x.tag)).toEqual(['0008_a']);
  });

  it('leaves newer migrations to Drizzle', () => {
    const recorded = [{ hash: '0007', createdAt: 700 }];
    expect(skippedMigrations(all, recorded)).toEqual([]);
  });

  it('does nothing on a fresh database', () => {
    expect(skippedMigrations(all, [])).toEqual([]);
  });
});

describe('readMigrations', () => {
  it('hashes every journal entry the way Drizzle records it, with unique timestamps', () => {
    const migs = readMigrations(fileURLToPath(new URL('./migrations', import.meta.url)));
    expect(migs.length).toBeGreaterThan(0);
    expect(migs.every((x) => /^[0-9a-f]{64}$/.test(x.hash))).toBe(true);
    expect(new Set(migs.map((x) => x.when)).size).toBe(migs.length);
    expect(migs.map((x) => x.idx)).toEqual(migs.map((_, i) => i));
  });
});
