/**
 * G5 — words that must never appear in customer- or shop-facing copy, because
 * they make the plan list look like an online sale (SC orders, SPEC §1).
 * Checked by `pnpm copy-lint` over i18n catalogues and .tsx string literals.
 */
export const BANNED_COPY_TERMS = [
  'order',
  'orders',
  'ordered',
  'reserve',
  'reserved',
  'reservation',
  'reservations',
  'cart',
  'checkout',
  'buy now',
  'booking confirmed',
  'delivery',
  'deliver',
  'delivered',
  '100% legal',
] as const;

/** Legal references are allowed: the G8 safety notice says "as per Supreme Court orders". */
const ALLOWED_PHRASES = /supreme court order(s)?/g;

export function findBannedTerms(text: string): string[] {
  const lower = text.toLowerCase().replace(ALLOWED_PHRASES, '');
  return BANNED_COPY_TERMS.filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(lower);
  });
}

/** G8 — shown on every ticket. */
export const SAFETY_NOTICE_KEY = 'safety.notice';

/** G3 — payment SDKs and links that must never be added. */
export const BANNED_PAYMENT_PACKAGES = [
  'razorpay',
  'stripe',
  'paytm',
  'phonepe',
  'cashfree',
  'payu',
] as const;
