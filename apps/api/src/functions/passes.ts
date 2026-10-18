// Customer Express Pass (SPEC_V2 §4). Flat fee, verifies the customer only (G10).
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { PASS_FEE_PAISE, type CurrentPassResponse } from '@pataka/shared';
import { getDb } from '../db/client';
import { requireUser } from '../lib/auth';
import { env } from '../lib/env';
import { HttpError } from '../lib/errors';
import { http, json } from '../lib/http';
import { currentPass, passView, rotateSecret, startPass } from '../lib/passes';
import { rateLimit } from '../lib/rateLimit';

/** GET /api/passes/current */
export async function currentPassHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  const current = await currentPass(db, user.id);
  const body: CurrentPassResponse = {
    enabled: env.passesEnabled(),
    feePaise: PASS_FEE_PAISE,
    pass: current ? passView(current.pass, current.openPayment) : null,
  };
  return json(body);
}

/** POST /api/passes — create or resume the pass and open a payment attempt. No body. */
export async function startPassHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  if (user.blockedUntil && user.blockedUntil > new Date()) {
    throw new HttpError(403, 'blocked', 'This number is blocked. Please contact support.');
  }
  await rateLimit(db, `pass-start:${user.id}`, 10, 3600);
  return json(await startPass(db, user.id), 201);
}

/** POST /api/passes/current/qr — rotate and reveal the QR secret (old QR stops working). */
export async function passQrHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  await rateLimit(db, `pass-qr:${user.id}`, 10, 3600);
  return json(await rotateSecret(db, user.id));
}

http('passesCurrent', ['GET'], 'passes/current', currentPassHandler);
http('passesStart', ['POST'], 'passes', startPassHandler);
http('passesQr', ['POST'], 'passes/current/qr', passQrHandler);
