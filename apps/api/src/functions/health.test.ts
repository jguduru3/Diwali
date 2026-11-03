import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@pataka/shared';
import { healthHandler } from './health';

describe('GET /api/health', () => {
  it('returns 200 {ok:true, db:true} when the DB answers', async () => {
    const res = await healthHandler(async () => true);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.jsonBody)).toEqual({ ok: true, db: true });
  });

  it('returns 503 {ok:false, db:false} when the DB is down', async () => {
    const res = await healthHandler(async () => false);
    expect(res.status).toBe(503);
    expect(res.jsonBody).toEqual({ ok: false, db: false });
  });
});
