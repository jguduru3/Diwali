import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api } from './api';

const schema = z.object({ id: z.number(), isStandard: z.boolean() });
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('refetches without the HTTP cache when a bodyless 304 reaches it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/shops/SLC01/items')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ cache: 'reload' });
  });
});

describe('api: responses cached before a release', () => {
  it('refetches a GET past the HTTP cache when the cached copy no longer fits the schema', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ id: 1 })) // old shape, served from the browser cache
      .mockResolvedValueOnce(reply({ id: 1, isStandard: false }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/shops/X/items', { schema })).resolves.toEqual({ id: 1, isStandard: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ cache: 'reload' });
  });

  it('still fails when a fresh copy does not fit either', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => reply({ id: 1 })),
    );
    await expect(api('/shops/X/items', { schema })).rejects.toThrow();
  });

  it('never retries a mutation', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply({ id: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/orders', { method: 'POST', body: {}, schema })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
