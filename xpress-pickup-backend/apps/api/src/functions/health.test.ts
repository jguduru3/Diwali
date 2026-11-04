import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@pataka/shared';
import { healthHandler } from './health';

describe('GET /api/health', () => {
  it('returns 200 when the DB answers and the settings are complete', async () => {
    const res = await healthHandler(
      async () => true,
      () => true,
    );
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.jsonBody)).toEqual({ ok: true, db: true, config: true });
  });

  it('returns 503 when the DB is down', async () => {
    const res = await healthHandler(
      async () => false,
      () => true,
    );
    expect(res.status).toBe(503);
    expect(res.jsonBody).toEqual({ ok: false, db: false, config: true });
  });

  it('returns 503 when production settings are missing', async () => {
    const res = await healthHandler(
      async () => true,
      () => false,
    );
    expect(res.status).toBe(503);
    expect(res.jsonBody).toEqual({ ok: false, db: true, config: false });
  });
});
