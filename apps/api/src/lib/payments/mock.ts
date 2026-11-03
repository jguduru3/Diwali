// Mock provider for dev, demo and tests. Never available in prod (env guard).
// Events are HMAC-SHA256 signed exactly like a real provider's, and go through
// the same webhook processor, so the verification path is exercised end to end.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env';
import {
  WebhookSignatureError,
  type HeaderReader,
  type PaymentProvider,
  type ProviderEvent,
} from './types';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

const eventSchema: z.ZodType<ProviderEvent> = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('payment.captured'),
    checkoutId: z.string().min(1),
    paymentId: z.string().min(1),
    amountPaise: z.number().int().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('payment.failed'),
    checkoutId: z.string().min(1),
    amountPaise: z.number().int().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.enum(['refund.processed', 'refund.failed']),
    refundId: z.string().min(1),
    paymentId: z.string().min(1),
    amountPaise: z.number().int().positive(),
  }),
]);

const sign = (body: string) =>
  createHmac('sha256', env.mockPaymentSecret()).update(body, 'utf8').digest('hex');

export const mockId = (prefix: string) => `${prefix}_${randomBytes(9).toString('hex')}`;

/** Signed raw body + headers, as the mock "provider" would POST them. */
export function signMockEvent(event: ProviderEvent): { rawBody: string; headers: HeaderReader } {
  const rawBody = JSON.stringify(event);
  const signature = `sha256=${sign(rawBody)}`;
  return {
    rawBody,
    headers: { get: (n) => (n.toLowerCase() === MOCK_SIGNATURE_HEADER ? signature : null) },
  };
}

export const mockProvider: PaymentProvider = {
  name: 'mock',

  async createCheckout() {
    const checkoutId = mockId('mock_ck');
    return { checkoutId, url: `/pay/mock/${checkoutId}` };
  },

  verifyWebhook(rawBody, headers) {
    const header = headers.get(MOCK_SIGNATURE_HEADER) ?? '';
    const given = Buffer.from(header.replace(/^sha256=/, ''), 'hex');
    const expected = Buffer.from(sign(rawBody), 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new WebhookSignatureError('Bad signature');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError('Bad body');
    }
    const result = eventSchema.safeParse(parsed);
    if (!result.success) throw new WebhookSignatureError('Unknown event');
    return result.data;
  },

  async refund() {
    return { refundId: mockId('mock_rf') };
  },
};
