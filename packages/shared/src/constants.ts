/** Business time zone for all display and day boundaries. */
export const BUSINESS_TZ = 'Asia/Kolkata';

/** Languages the PWA ships with. Telugu strings need native review before launch. */
export const SUPPORTED_LANGUAGES = ['en', 'te'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Version of the consent text shown at sign-in (G9). Bump when the wording changes. */
export const CONSENT_VERSION = '2026-10-v2';
export const CONSENT_PURPOSE = 'express_pass_and_misuse_prevention';

/** Sent on every mutating request; the API rejects mutations without it (CSRF, SPEC §10). */
export const CSRF_HEADER = 'X-PP';
export const SESSION_COOKIE = 'pp_session';

/**
 * How an item is sold: by the pack, by weight at its own ₹/kg, or as a box of any
 * items the customer picks at one fixed ₹/kg (prices per kg, stock in grams).
 */
export const SALE_UNITS = ['pack', 'kg', 'mix_kg'] as const;
export type SaleUnit = (typeof SALE_UNITS)[number];
