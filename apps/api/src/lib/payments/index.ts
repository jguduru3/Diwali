import { env } from '../env';
import { HttpError } from '../errors';
import { mockProvider } from './mock';
import type { PaymentProvider } from './types';

export * from './types';

/**
 * Registered adapters. A real, RBI-authorised provider is added here as another
 * adapter after the compliance review (SPEC_V2 §5, §9).
 */
const providers: Record<string, () => PaymentProvider> = {
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
