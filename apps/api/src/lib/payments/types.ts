// Payment provider adapter (SPEC_V2 §5). The platform collects only its own flat
// pass fee; no provider SDKs — adapters call provider REST APIs (G3).

/** Normalised, signature-verified provider event. */
export type ProviderEvent =
  | {
      id: string;
      type: 'payment.captured';
      checkoutId: string;
      paymentId: string;
      amountPaise: number;
    }
  | { id: string; type: 'payment.failed'; checkoutId: string; amountPaise: number }
  | {
      id: string;
      type: 'refund.processed' | 'refund.failed';
      refundId: string;
      paymentId: string;
      amountPaise: number;
    };

export type HeaderReader = { get(name: string): string | null };

export interface PaymentProvider {
  readonly name: string;
  /** Opens a hosted payment page for the pass fee. */
  createCheckout(input: {
    idempotencyKey: string;
    amountPaise: number;
    reference: string;
  }): Promise<{ checkoutId: string; url: string }>;
  /** Throws WebhookSignatureError unless the raw body carries a valid signature. */
  verifyWebhook(rawBody: string, headers: HeaderReader): ProviderEvent;
  /** Asks the provider to refund a captured payment. The outcome arrives as an event. */
  refund(input: {
    paymentId: string;
    amountPaise: number;
    idempotencyKey: string;
  }): Promise<{ refundId: string }>;
}

export class WebhookSignatureError extends Error {}
