import { app, type HttpResponseInit } from '@azure/functions';
import type { HealthResponse } from '@pataka/shared';
import { pingDb } from '../db/client';
import { productionReady } from '../lib/prodConfig';

/**
 * 200 when the DB answers and (in production) every live setting is in place, 503 otherwise,
 * so `curl -f /api/health` fails on a dead DB or a missing secret.
 */
export async function healthHandler(
  ping: () => Promise<boolean> = pingDb,
  ready: () => boolean = productionReady,
): Promise<HttpResponseInit> {
  const db = await ping();
  const config = ready();
  const body: HealthResponse = { ok: db && config, db, config };
  return {
    status: body.ok ? 200 : 503,
    jsonBody: body,
    headers: { 'Cache-Control': 'no-store' },
  };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: () => healthHandler(),
});
