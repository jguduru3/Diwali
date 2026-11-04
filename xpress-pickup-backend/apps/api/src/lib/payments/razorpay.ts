// Razorpay adapter (REST, no SDK — G3). The platform collects only its flat fees: the ₹30 order
// fee and the merchant subscription, each through a hosted Payment Link. Events arrive on
// /api/payments/webhook/razorpay, signed with the webhook secret (HMAC-SHA256 of the raw body).
// Docs: razorpay.com/docs/api/payments/payment-links, /webhooks/validate-test, /refunds.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env';
import {
  WebhookSignatureError,
  type HeaderReader,
  type PaymentProvider,
  type ProviderEvent,
} from './types';

const API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;
export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
const EVENT_ID_HEADER = 'x-razorpay-event-id';

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`Razorpay ${status}: ${description}`);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { keyId, keySecret } = env.razorpay();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const description =
      (data as { error?: { description?: string } } | null)?.error?.description ??
      text.slice(0, 200);
    throw new RazorpayError(res.status, description);
  }
  return data as T;
}

/** Razorpay's reference_id is at most 40 characters: a stable digest of our idempotency key. */
export const referenceId = (idempotencyKey: string) =>
  createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40);

const link = z.object({ id: z.string(), short_url: z.string().url() });

const entity = <T extends z.ZodTypeAny>(schema: T) => z.object({ entity: schema });
const webhookSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment_link: entity(z.object({ id: z.string(), amount: z.number().int() })).optional(),
      payment: entity(z.object({ id: z.string(), amount: z.number().int() })).optional(),
      refund: entity(
        z.object({ id: z.string(), payment_id: z.string(), amount: z.number().int() }),
      ).optional(),
    })
    .passthrough(),
});

function verifySignature(rawBody: string, header: string) {
  const expected = createHmac('sha256', env.razorpay().webhookSecret)
    .update(rawBody, 'utf8')
    .digest();
  const given = Buffer.from(header, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new WebhookSignatureError('Bad signature');
  }
}

/** Maps a verified Razorpay webhook to our event; events we do not act on return null. */
export function parseRazorpayEvent(rawBody: string, eventId: string): ProviderEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WebhookSignatureError('Bad body');
  }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) throw new WebhookSignatureError('Unknown event');
  const { event, payload } = parsed.data;
  const id = eventId || createHash('sha256').update(rawBody).digest('hex');
  const pl = payload.payment_link?.entity;
  const pay = payload.payment?.entity;
  const rf = payload.refund?.entity;
  switch (event) {
    case 'payment_link.paid':
      if (!pl || !pay) throw new WebhookSignatureError('Missing payload');
      return {
        id,
        type: 'payment.captured',
        checkoutId: pl.id,
        paymentId: pay.id,
        amountPaise: pay.amount,
      };
    case 'payment_link.expired':
    case 'payment_link.cancelled':
      if (!pl) throw new WebhookSignatureError('Missing payload');
      return { id, type: 'payment.failed', checkoutId: pl.id, amountPaise: pl.amount };
    case 'refund.processed':
    case 'refund.failed':
      if (!rf) throw new WebhookSignatureError('Missing payload');
      return {
        id,
        type: event,
        refundId: rf.id,
        paymentId: rf.payment_id,
        amountPaise: rf.amount,
      };
    default:
      return null; // e.g. payment.authorized: acknowledged, nothing to do
  }
}

export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',

  async createCheckout({ idempotencyKey, amountPaise, reference, returnPath }) {
    const ref = referenceId(idempotencyKey);
    const origin = env.publicOrigin();
    try {
      const created = link.parse(
        await call('POST', '/payment_links', {
          amount: amountPaise,
          currency: 'INR',
          accept_partial: false,
          reference_id: ref,
          description: reference,
          notify: { sms: false, email: false },
          reminder_enable: false,
          notes: { reference },
          ...(origin && returnPath
            ? { callback_url: `${origin}${returnPath}`, callback_method: 'get' }
            : {}),
        }),
      );
      return { checkoutId: created.id, url: created.short_url };
    } catch (err) {
      // A retry with the same key: Razorpay keeps reference_id unique, so return that link.
      if (
        err instanceof RazorpayError &&
        err.status === 400 &&
        /reference/i.test(err.description)
      ) {
        const found = z
          .object({ payment_links: z.array(link) })
          .parse(await call('GET', `/payment_links?reference_id=${encodeURIComponent(ref)}`));
        const existing = found.payment_links[0];
        if (existing) return { checkoutId: existing.id, url: existing.short_url };
      }
      throw err;
    }
  },

  verifyWebhook(rawBody: string, headers: HeaderReader) {
    verifySignature(rawBody, headers.get(RAZORPAY_SIGNATURE_HEADER) ?? '');
    return parseRazorpayEvent(rawBody, headers.get(EVENT_ID_HEADER) ?? '');
  },

  async refund({ paymentId, amountPaise, idempotencyKey }) {
    const res = z.object({ id: z.string() }).parse(
      await call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
        amount: amountPaise,
        speed: 'normal',
        receipt: referenceId(idempotencyKey),
      }),
    );
    return { refundId: res.id };
  },
};
