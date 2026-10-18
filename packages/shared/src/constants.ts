/** Business time zone for all display and day boundaries. */
export const BUSINESS_TZ = 'Asia/Kolkata';

/** Languages the PWA ships with. Telugu strings need native review before launch. */
export const SUPPORTED_LANGUAGES = ['en', 'te'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Version of the consent text shown at sign-in (G9). Bump when the wording changes. */
export const CONSENT_VERSION = '2026-10-v1';
export const CONSENT_PURPOSE = 'slot_holding_and_misuse_prevention';

/** Sent on every mutating request; the API rejects mutations without it (CSRF, SPEC §10). */
export const CSRF_HEADER = 'X-PP';
export const SESSION_COOKIE = 'pp_session';
