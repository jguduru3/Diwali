// Provider webhooks and the mock provider's test checkout (SPEC_V2 §5).
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { eq } from 'drizzle-orm';
import { formatPassRef, mockCompleteSchema, type MockCheckout } from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import { passes, payments } from '../db/schema';
import { requireUser } from '../lib/auth';
import { errorResponse, HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import { applyProviderEvent } from '../lib/passes';
import { providerByName, WebhookSignatureError, type HeaderReader } from '../lib/payments';
import { mockId, mockProvider, signMockEvent } from '../lib/payments/mock';

/** Verifies the signature on the raw body, then applies the event once. */
export async function processWebhook(
  db: Db,
  providerName: string | undefined,
  rawBody: string,
  headers: HeaderReader,
) {
  const provider = providerByName(providerName);
  let event;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      throw new HttpError(401, 'bad_signature', 'Invalid webhook signature');
    }
    throw err;
  }
  return applyProviderEvent(db, provider.name, event, rawBody);
}

/**
 * POST /api/payments/webhook/{provider} — server-to-server, so no CSRF header
 * and no session; trust comes only from the signature.
 */
export async function webhookHandler(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const rawBody = await req.text();
    if (rawBody.length > 64 * 1024) throw new HttpError(413, 'too_large', 'Body too large');
    const outcome = await processWebhook(getDb(), req.params.provider, rawBody, req.headers);
    return json({ ok: true, outcome });
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
    return errorResponse(500, 'internal', 'Something went wrong');
  }
}

async function loadMockCheckout(db: Db, checkoutId: string | undefined, userId: string) {
  const [row] = await db
    .select({ payment: payments, pass: passes })
    .from(payments)
    .innerJoin(passes, eq(passes.id, payments.passId))
    .where(eq(payments.checkoutId, checkoutId ?? ''));
  if (!row || row.payment.provider !== 'mock' || row.pass.userId !== userId) {
    throw new HttpError(404, 'checkout_not_found', 'No such payment');
  }
  return row;
}

/** GET /api/payments/mock/{checkoutId} — what the test checkout page shows. */
export async function mockCheckoutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  providerByName('mock');
  const { payment, pass } = await loadMockCheckout(db, req.params.checkoutId, user.id);
  const body: MockCheckout = {
    checkoutId: payment.checkoutId,
    amountPaise: payment.amountPaise,
    passRef: formatPassRef(pass.ref),
    status: payment.status,
  };
  return json(body);
}

/**
 * POST /api/payments/mock/{checkoutId}/complete {outcome} — the mock "provider"
 * signs an event and sends it through the real webhook path.
 */
export async function mockCompleteHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const user = await requireUser(db, req);
  providerByName('mock');
  const { outcome } = await parseBody(req, mockCompleteSchema);
  const { payment } = await loadMockCheckout(db, req.params.checkoutId, user.id);
  const signed = signMockEvent(
    outcome === 'success'
      ? {
          id: mockId('mock_ev'),
          type: 'payment.captured',
          checkoutId: payment.checkoutId,
          paymentId: mockId('mock_pay'),
          amountPaise: payment.amountPaise,
        }
      : {
          id: mockId('mock_ev'),
          type: 'payment.failed',
          checkoutId: payment.checkoutId,
          amountPaise: payment.amountPaise,
        },
  );
  const result = await processWebhook(db, mockProvider.name, signed.rawBody, signed.headers);
  return json({ ok: true, outcome: result });
}

app.http('paymentsWebhook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'payments/webhook/{provider}',
  handler: (req) => webhookHandler(req),
});
http('paymentsMockCheckout', ['GET'], 'payments/mock/{checkoutId}', mockCheckoutHandler);
http('paymentsMockComplete', ['POST'], 'payments/mock/{checkoutId}/complete', mockCompleteHandler);
