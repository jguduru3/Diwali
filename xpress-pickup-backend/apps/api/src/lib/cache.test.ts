import { describe, expect, it } from 'vitest';
import { TtlCache } from './cache';

describe('TtlCache', () => {
  it('serves a value until it expires, then loads again', async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, 100, () => t);
    let loads = 0;
    const load = async () => ++loads;
    expect(await cache.get('k', load)).toBe(1);
    t = 999;
    expect(await cache.get('k', load)).toBe(1);
    t = 1000;
    expect(await cache.get('k', load)).toBe(2);
  });

  it('runs one load for many concurrent callers', async () => {
    const cache = new TtlCache<string>(1000);
    let loads = 0;
    let release!: (v: string) => void;
    const load = () => {
      loads++;
      return new Promise<string>((r) => (release = r));
    };
    const all = Promise.all(Array.from({ length: 50 }, () => cache.get('k', load)));
    release('v');
    expect(await all).toEqual(Array(50).fill('v'));
    expect(loads).toBe(1);
  });

  it('does not cache a failed load', async () => {
    const cache = new TtlCache<number>(1000);
    await expect(cache.get('k', () => Promise.reject(new Error('db down')))).rejects.toThrow();
    expect(await cache.get('k', async () => 7)).toBe(7);
  });

  it('stays within its size limit', async () => {
    const cache = new TtlCache<number>(60_000, 3);
    for (const k of ['a', 'b', 'c', 'd']) await cache.get(k, async () => 1);
    let reloaded = false;
    await cache.get('a', async () => ((reloaded = true), 2));
    expect(reloaded).toBe(true); // the oldest entry made room
  });
});
