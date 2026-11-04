import { env } from '../env';
import { HttpError } from '../errors';
import { mockProvider } from './mock';
import { razorpayProvider } from './razorpay';
import type { PaymentProvider } from './types';

export * from './types';

/** Registered adapters: Razorpay (live) and the mock (dev and tests only). */
const providers: Record<string, () => PaymentProvider> = {
  razorpay: () => {
    env.razorpay(); // throws when the keys are missing
    return razorpayProvider;
  },
  mock: () => {
    env.mockPaymentSecret(); // throws in prod
    return mockProvider;
  },
};

/** The configured provider for new checkouts and refunds. */
export function activeProvider(): PaymentProvider {
  const name = env.paymentProvider();
  const make = providers[name];
  if (!make) throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
  return make();
}

/** The provider named in a webhook URL; 404 when unknown or not allowed here. */
export function providerByName(name: string | undefined): PaymentProvider {
  const make = name ? providers[name] : undefined;
  if (!make) throw new HttpError(404, 'not_found', 'Not found');
  try {
    return make();
  } catch {
    throw new HttpError(404, 'not_found', 'Not found');
  }
}
