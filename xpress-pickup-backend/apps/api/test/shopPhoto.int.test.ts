// The shop entrance photo: the owner (or the agent during setup) uploads it, and customers see
// it with the shop's name on the public list and shop page.
import { describe, expect, it } from 'vitest';
import type { ShopContext, ShopSummary } from '@pataka/shared';
import { mediaHandler } from '../src/functions/media';
import { shopDetailHandler, shopsHandler } from '../src/functions/public';
import { shopPhotoHandler } from '../src/functions/shop';
import { body, call, errorCode, makeListedShop } from './helpers';

// smallest valid PNG (1×1), padded so the upload passes the size floor
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const upload = (session: string, base64 = png.padEnd(120, '=')) =>
  call(shopPhotoHandler, {
    method: 'POST',
    session,
    body: { contentType: 'image/png', base64 },
  });

describe('shop entrance photo', () => {
  it('the owner uploads it; customers see it on the list and the shop page', async () => {
    process.env.CATALOGUE_CACHE_SECONDS = '0';
    try {
      const shop = await makeListedShop('PHO01');
      const res = await upload(shop.owner.session);
      expect(res.status).toBe(200);
      const ctx = body<ShopContext>(res);
      expect(ctx.photoUrl).toMatch(/^\/api\/media\/shops\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);

      const list = body<ShopSummary[]>(await call(shopsHandler));
      expect(list.find((s) => s.shortCode === 'PHO01')!.photoUrl).toBe(ctx.photoUrl);
      const detail = await call(shopDetailHandler, { params: { code: 'PHO01' } });
      expect(body<ShopSummary>(detail).photoUrl).toBe(ctx.photoUrl);

      const file = await call(mediaHandler, {
        params: { path: ctx.photoUrl!.replace('/api/media/', '') },
      });
      expect(file.status).toBe(200);
      expect(file.headers).toMatchObject({ 'Content-Type': 'image/png' });
    } finally {
      delete process.env.CATALOGUE_CACHE_SECONDS;
    }
  });

  it('only the owner may change it, and only with a real image', async () => {
    const shop = await makeListedShop('PHO02');
    expect(errorCode(await upload(shop.staff.session))).toBe('owner_only');
    const notImage = Buffer.from('x'.repeat(200)).toString('base64');
    expect(errorCode(await upload(shop.owner.session, notImage))).toBe('bad_image');
  });
});
