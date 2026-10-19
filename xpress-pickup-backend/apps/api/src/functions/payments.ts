// Payment webhooks (SPEC_V3 §4, §7) and the mock fee checkout. Webhooks are
// server-to-server: no session, no CSRF header — trust comes only from the HMAC
// signature on the raw body.
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { and, eq } from 'drizzle-orm';
import { formatOrderCode, mockCompleteSchema, type MockCheckout } from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import { feePayments, merchantSubscriptions, orders, shops } from '../db/schema';
import { getSessionUser } from '../lib/auth';
import { processYoupiWebhook } from '../lib/counter';
import { errorResponse, HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import { processFeeWebhook } from '../lib/orders';
import { providerByName } from '../lib/payments';
import { drainQuietly } from '../lib/push';
import { mockId, mockProvider, signMockEvent } from '../lib/payments/mock';

const MAX_WEBHOOK_BYTES = 64 * 1024;

function rawWebhook(handle: (req: HttpRequest, rawBody: string) => Promise<string>) {
  return async (req: HttpRequest): Promise<HttpResponseInit> => {
    try {
      const rawBody = await req.text();
      if (rawBody.length > MAX_WEBHOOK_BYTES)
        throw new HttpError(413, 'too_large', 'Body too large');
      const outcome = await handle(req, rawBody);
      await drainQuietly(getDb());
      return json({ ok: true, outcome });
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      return errorResponse(500, 'internal', 'Something went wrong');
    }
  };
}

/** POST /api/payments/webhook/{provider} — the platform's ₹30 fee provider. */
export const feeWebhookHandler = rawWebhook((req, raw) =>
  processFeeWebhook(getDb(), req.params.provider, raw, req.headers),
);

/** POST /api/payments/youpi/{shopCode} — a merchant's own YouPI-PG instance. */
export const youpiWebhookHandler = rawWebhook((req, raw) =>
  processYoupiWebhook(getDb(), req.params.shopCode, raw, req.headers),
);

type MockTarget = {
  checkoutId: string;
  amountPaise: number;
  label: string;
  status: string;
  orderId: string | null;
};

/**
 * The mock provider's checkout: a ₹30 order fee (only its customer may open it) or a merchant
 * subscription (opened from the owner's review link, no sign-in). Dev and tests only.
 */
async function loadMockCheckout(
  db: Db,
  checkoutId: string | undefined,
  userId: string | null,
): Promise<MockTarget> {
  const [row] = await db
    .select({ pay: feePayments, order: orders })
    .from(feePayments)
    .innerJoin(orders, eq(orders.id, feePayments.orderId))
    .where(eq(feePayments.checkoutId, checkoutId ?? ''));
  if (row) {
    if (row.pay.provider !== 'mock' || row.order.userId !== userId) {
      throw new HttpError(404, 'checkout_not_found', 'No such payment');
    }
    return {
      checkoutId: row.pay.checkoutId,
      amountPaise: row.pay.amountPaise,
      label: formatOrderCode(row.order.code),
      status: row.pay.status,
      orderId: row.order.id,
    };
  }
  const [sub] = await db
    .select({ s: merchantSubscriptions, code: shops.shortCode })
    .from(merchantSubscriptions)
    .innerJoin(shops, eq(shops.id, merchantSubscriptions.shopId))
    .where(
      and(
        eq(merchantSubscriptions.checkoutId, checkoutId ?? ''),
        eq(merchantSubscriptions.provider, 'mock'),
      ),
    );
  if (!sub) throw new HttpError(404, 'checkout_not_found', 'No such payment');
  return {
    checkoutId: sub.s.checkoutId!,
    amountPaise: sub.s.amountPaise + sub.s.gstPaise,
    label: `SUB-${sub.code}`,
    status: sub.s.status === 'paid' ? 'captured' : 'created',
    orderId: null,
  };
}

/** GET /api/payments/mock/{checkoutId} — what the test checkout page shows. */
export async function mockCheckoutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await getSessionUser(db, req);
  providerByName('mock');
  const pay = await loadMockCheckout(db, req.params.checkoutId, user?.id ?? null);
  const body: MockCheckout = {
    checkoutId: pay.checkoutId,
    amountPaise: pay.amountPaise,
    orderCode: pay.label,
    status: pay.status as MockCheckout['status'],
  };
  return json(body);
}

/**
 * POST /api/payments/mock/{checkoutId}/complete {outcome} — the mock "provider"
 * signs an event and sends it through the real webhook path.
 */
export async function mockCompleteHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await getSessionUser(db, req);
  providerByName('mock');
  const { outcome } = await parseBody(req, mockCompleteSchema);
  const pay = await loadMockCheckout(db, req.params.checkoutId, user?.id ?? null);
  const signed = signMockEvent(
    outcome === 'success'
      ? {
          id: mockId('mock_ev'),
          type: 'payment.captured',
          checkoutId: pay.checkoutId,
          paymentId: mockId('mock_pay'),
          amountPaise: pay.amountPaise,
        }
      : {
          id: mockId('mock_ev'),
          type: 'payment.failed',
          checkoutId: pay.checkoutId,
          amountPaise: pay.amountPaise,
        },
  );
  const result = await processFeeWebhook(db, mockProvider.name, signed.rawBody, signed.headers);
  return json({ ok: true, outcome: result, orderId: pay.orderId });
}

app.http('paymentsFeeWebhook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'payments/webhook/{provider}',
  handler: (req) => feeWebhookHandler(req),
});
app.http('paymentsYoupiWebhook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'payments/youpi/{shopCode}',
  handler: (req) => youpiWebhookHandler(req),
});
http('paymentsMockCheckout', ['GET'], 'payments/mock/{checkoutId}', mockCheckoutHandler);
http('paymentsMockComplete', ['POST'], 'payments/mock/{checkoutId}/complete', mockCompleteHandler);
