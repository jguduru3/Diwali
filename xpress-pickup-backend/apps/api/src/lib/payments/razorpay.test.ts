import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookSignatureError } from './types';
import { RAZORPAY_SIGNATURE_HEADER, razorpayProvider, referenceId } from './razorpay';

const SECRET = 'whsec_test_razorpay_secret';
const headers = (body: string, secret = SECRET, eventId = 'evt_1') => {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const h: Record<string, string> = {
    [RAZORPAY_SIGNATURE_HEADER]: sig,
    'x-razorpay-event-id': eventId,
  };
  return { get: (n: string) => h[n.toLowerCase()] ?? null };
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  process.env.PUBLIC_ORIGIN = 'https://pickup.example.in';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APP_ENV;
});

describe('razorpay webhooks', () => {
  const paid = JSON.stringify({
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: 'plink_1', amount: 3000 } },
      payment: { entity: { id: 'pay_1', amount: 3000 } },
    },
  });

  it('maps a paid link to a captured payment', () => {
    expect(razorpayProvider.verifyWebhook(paid, headers(paid))).toEqual({
      id: 'evt_1',
      type: 'payment.captured',
      checkoutId: 'plink_1',
      paymentId: 'pay_1',
      amountPaise: 3000,
    });
  });

  it('rejects a wrong or missing signature', () => {
    expect(() => razorpayProvider.verifyWebhook(paid, headers(paid, 'other'))).toThrow(
      WebhookSignatureError,
    );
    expect(() => razorpayProvider.verifyWebhook(paid, { get: () => null })).toThrow(
      WebhookSignatureError,
    );
    const tampered = paid.replace('3000', '1');
    expect(() => razorpayProvider.verifyWebhook(tampered, headers(paid))).toThrow(
      WebhookSignatureError,
    );
  });

  it('maps refunds and expired links, and acknowledges other events', () => {
    const refund = JSON.stringify({
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 3000 } } },
    });
    expect(razorpayProvider.verifyWebhook(refund, headers(refund))).toMatchObject({
      type: 'refund.processed',
      refundId: 'rfnd_1',
      paymentId: 'pay_1',
    });
    const expired = JSON.stringify({
      event: 'payment_link.expired',
      payload: { payment_link: { entity: { id: 'plink_2', amount: 235900 } } },
    });
    expect(razorpayProvider.verifyWebhook(expired, headers(expired))).toMatchObject({
      type: 'payment.failed',
      checkoutId: 'plink_2',
    });
    const other = JSON.stringify({ event: 'payment.authorized', payload: {} });
    expect(razorpayProvider.verifyWebhook(other, headers(other))).toBeNull();
  });
});

describe('razorpay checkout and refunds', () => {
  it('creates a payment link with a stable reference and the return URL', async () => {
    const fetch = vi.fn(async () => reply(200, { id: 'plink_9', short_url: 'https://rzp.io/i/x' }));
    vi.stubGlobal('fetch', fetch);
    const out = await razorpayProvider.createCheckout({
      idempotencyKey: 'fee:order-1:1',
      amountPaise: 3000,
      reference: 'DEM-091',
      returnPath: '/orders/order-1',
    });
    expect(out).toEqual({ checkoutId: 'plink_9', url: 'https://rzp.io/i/x' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 3000,
      currency: 'INR',
      reference_id: referenceId('fee:order-1:1'),
      callback_url: 'https://pickup.example.in/orders/order-1',
    });
    expect(referenceId('fee:order-1:1')).toHaveLength(40);
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('rzp_test_abc:secret').toString('base64')}`,
    );
  });

  it('returns the existing link when a retry reuses the reference', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(400, { error: { description: 'reference_id already exists' } }))
      .mockResolvedValueOnce(
        reply(200, { payment_links: [{ id: 'plink_old', short_url: 'https://rzp.io/i/old' }] }),
      );
    vi.stubGlobal('fetch', fetch);
    const out = await razorpayProvider.createCheckout({
      idempotencyKey: 'sub:shop:1',
      amountPaise: 235900,
      reference: 'SUB-M1',
    });
    expect(out.checkoutId).toBe('plink_old');
  });

  it('refunds a payment and surfaces provider errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, { id: 'rfnd_7' })),
    );
    await expect(
      razorpayProvider.refund({ paymentId: 'pay_1', amountPaise: 3000, idempotencyKey: 'k' }),
    ).resolves.toEqual({ refundId: 'rfnd_7' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(400, { error: { description: 'fully refunded' } })),
    );
    await expect(
      razorpayProvider.refund({ paymentId: 'pay_1', amountPaise: 3000, idempotencyKey: 'k' }),
    ).rejects.toThrow(/fully refunded/);
  });

  it('refuses test keys in production', async () => {
    process.env.APP_ENV = 'prod';
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      razorpayProvider.createCheckout({ idempotencyKey: 'k', amountPaise: 3000, reference: 'x' }),
    ).rejects.toThrow(/live Razorpay keys/);
  });
});
