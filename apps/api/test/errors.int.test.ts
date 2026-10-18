import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { items } from '../src/db/schema';
import { pgError, route } from '../src/lib/http';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { makeListedShop } from './helpers';

describe('database errors reach the client as clear API errors', () => {
  it('a trigger rejection inside a handler becomes 422 category_banned, not 500', async () => {
    const { shop, bannedCategory } = await makeListedShop();
    const handler = route(async () => {
      await getDb().insert(items).values({
        shopId: shop.id,
        itemNo: 50,
        categoryId: bannedCategory.id,
        nameEn: 'x',
        pricePaise: 100,
        greenCert: 'CSIR_NEERI_SWAS',
        greenRef: 'R-1',
      });
      return { status: 200 };
    });
    const res = await handler(
      new HttpRequest({ method: 'GET', url: 'http://x/' }),
      new InvocationContext(),
    );
    expect(res.status).toBe(422);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe('category_banned');
  });

  it('pgError unwraps Drizzle query errors', async () => {
    const err = await getDb()
      .execute('select 1/0' as never)
      .catch((e: unknown) => e);
    expect(pgError(err)?.code).toBe('22012');
  });
});
