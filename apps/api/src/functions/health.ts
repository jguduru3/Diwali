import { app, type HttpResponseInit } from '@azure/functions';
import type { HealthResponse } from '@pataka/shared';
import { pingDb } from '../db/client';

/** 200 when the DB answers, 503 otherwise, so `curl -f /api/health` fails on a dead DB. */
export async function healthHandler(
  ping: () => Promise<boolean> = pingDb,
): Promise<HttpResponseInit> {
  const db = await ping();
  const body: HealthResponse = { ok: db, db };
  return {
    status: db ? 200 : 503,
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
