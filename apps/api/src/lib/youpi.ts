// Client for a merchant's own YouPI-PG instance (github.com/youpi-pg/YouPI-PG,
// openapi.yaml): the customer pays the MERCHANT's UPI at the counter. The
// platform never receives this money (G3).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './errors';

export type YoupiConfig = { baseUrl: string; merchantId: string | null };

/** README: "X-Gateway-Signature: sha256=<hash>", HMAC over the raw, unparsed body. */
export const YOUPI_SIGNATURE_HEADER = 'x-gateway-signature';

const TIMEOUT_MS = 8000;

const paiseFromRupees = (s: string) => Math.round(Number(s) * 100);
export const rupeesString = (paise: number) => (paise / 100).toFixed(2);

const createResponse = z.object({
  paymentId: z.string(),
  orderId: z.string(),
  amountPaise: z.union([z.string(), z.number()]).transform(Number),
  status: z.string(),
  checkoutUrl: z.string(),
});

const statusResponse = z.object({
  paymentId: z.string(),
  orderId: z.string(),
  amountPaise: z.union([z.string(), z.number()]).transform(Number),
  status: z.enum([
    'INITIATED',
    'ACTIVE',
    'QUEUED',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'EXPIRED',
    'CANCELLED',
  ]),
  method: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});
export type YoupiStatus = z.infer<typeof statusResponse>;

export const youpiWebhookSchema = z.object({
  event: z.enum(['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED']),
  paymentId: z.string().min(1),
  orderId: z.string().min(1),
  amountPaise: z.union([z.string(), z.number()]).transform(Number),
  utr: z.string().nullable().optional(),
});
export type YoupiWebhook = z.infer<typeof youpiWebhookSchema>;

async function call(cfg: YoupiConfig, path: string, init: RequestInit) {
  const url = new URL(path, cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`);
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (cfg.merchantId) headers['X-Merchant-Id'] = cfg.merchantId;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(
      502,
      'upi_unreachable',
      "Can't reach the shop's UPI service. Try card or cash.",
    );
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { res, body };
}

/** POST /api/v1/payments — idempotent on Idempotency-Key. */
export async function createYoupiPayment(
  cfg: YoupiConfig,
  input: { orderId: string; amountPaise: number; description: string; idempotencyKey: string },
) {
  const { res, body } = await call(cfg, 'api/v1/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify({
      orderId: input.orderId,
      amount: rupeesString(input.amountPaise),
      currency: 'INR',
      description: input.description,
      metadata: { source: 'diwali-express-pickup' },
    }),
  });
  if (!res.ok) {
    throw new HttpError(
      502,
      'upi_error',
      "The shop's UPI service refused the payment. Try card or cash.",
    );
  }
  const parsed = createResponse.safeParse(body);
  if (!parsed.success || parsed.data.amountPaise !== input.amountPaise) {
    throw new HttpError(502, 'upi_error', "Unexpected answer from the shop's UPI service");
  }
  return parsed.data;
}

/** GET /api/v1/payments/{id} — called server-to-server, so its answer can be trusted. */
export async function getYoupiStatus(
  cfg: YoupiConfig,
  paymentId: string,
): Promise<YoupiStatus | null> {
  const { res, body } = await call(cfg, `api/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
  });
  if (!res.ok) return null;
  const parsed = statusResponse.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export function verifyYoupiSignature(
  secret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!header) return false;
  const given = Buffer.from(header.replace(/^sha256=/, ''), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export { paiseFromRupees };
