// Customer orders (SPEC_V3). Bodies carry item ids and quantities only; the
// server prices everything (G11). Pickup and payment happen at the shop.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import {
  PLATFORM_FEE_PAISE,
  CONFIRM_WINDOW_HOURS,
  customerDecisionSchema,
  optionalReasonSchema,
  placeOrderSchema,
} from '@pataka/shared';
import { getDb } from '../db/client';
import { requireUser } from '../lib/auth';
import { env } from '../lib/env';
import { HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import {
  cancelByCustomer,
  customerDecision,
  customerOrderSummaries,
  getCustomerOrder,
  placeOrder,
  rotateCustomerQr,
  startFeePayment,
} from '../lib/orders';
import { requireUuidParam } from '../lib/access';
import { rateLimit } from '../lib/rateLimit';

/** GET /api/ordering — public: is online ordering on, and the fee terms. */
export async function orderingInfoHandler(): Promise<HttpResponseInit> {
  return json({
    enabled: env.orderingEnabled(),
    feePaise: PLATFORM_FEE_PAISE,
    confirmWindowHours: CONFIRM_WINDOW_HOURS,
  });
}

/** POST /api/orders {shopCode, lines:[{itemId, qty}]} */
export async function placeOrderHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  if (user.blockedUntil && user.blockedUntil > new Date()) {
    throw new HttpError(403, 'blocked', 'This number is blocked. Please contact support.');
  }
  const input = await parseBody(req, placeOrderSchema);
  await rateLimit(db, `order:${user.id}`, 20, 3600);
  return json(await placeOrder(db, user.id, input), 201);
}

/** GET /api/orders — my orders, newest first. */
export async function myOrdersHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  return json(await customerOrderSummaries(db, user.id));
}

/** GET /api/orders/{id} */
export async function orderHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  return json(await getCustomerOrder(db, user.id, requireUuidParam(req, 'id')));
}

/** POST /api/orders/{id}/fee — open (or reuse) the ₹30 checkout. No body. */
export async function feeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  await rateLimit(db, `fee:${user.id}`, 20, 3600);
  return json(await startFeePayment(db, user.id, requireUuidParam(req, 'id')));
}

/** POST /api/orders/{id}/cancel {reason?} */
export async function cancelHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  const { reason } = await parseBody(req, optionalReasonSchema);
  return json(await cancelByCustomer(db, user.id, requireUuidParam(req, 'id'), reason));
}

/** POST /api/orders/{id}/decisions {lineId, decision} */
export async function decisionHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  const input = await parseBody(req, customerDecisionSchema);
  return json(await customerDecision(db, user.id, requireUuidParam(req, 'id'), input));
}

/** POST /api/orders/{id}/pickup-qr — show (and rotate) the pickup QR. */
export async function pickupQrHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  await rateLimit(db, `pickup-qr:${user.id}`, 20, 3600);
  return json(await rotateCustomerQr(db, user.id, requireUuidParam(req, 'id')));
}

http('orderingInfo', ['GET'], 'ordering', orderingInfoHandler);
http('ordersPlace', ['POST'], 'orders', placeOrderHandler);
http('ordersMine', ['GET'], 'orders/mine', myOrdersHandler);
http('ordersOne', ['GET'], 'orders/{id}', orderHandler);
http('ordersFee', ['POST'], 'orders/{id}/fee', feeHandler);
http('ordersCancel', ['POST'], 'orders/{id}/cancel', cancelHandler);
http('ordersDecision', ['POST'], 'orders/{id}/decisions', decisionHandler);
http('ordersPickupQr', ['POST'], 'orders/{id}/pickup-qr', pickupQrHandler);
