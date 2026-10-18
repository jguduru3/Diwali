/**
 * Express Pass (SPEC_V2 §4). A flat-fee pass that verifies the customer at any
 * participating shop. It never reserves stock or confirms a purchase (G10).
 *
 *   QR text: DXP1.<26-char Crockford base32 secret>   (130 random bits)
 *
 * The server stores only a hash of the secret; the QR carries no phone number,
 * name, prices or items (G1, G9).
 */
import { z } from 'zod';
import { istDate, istInstant } from './time';

/** Flat platform verification fee in paise (G3, G4). */
export const PASS_FEE_PAISE = 3000;
export const PASS_QR_PREFIX = 'DXP1';
export const PASS_SECRET_LENGTH = 26;
export const PASS_REF_LENGTH = 8;

/** Crockford base32 without I, L, O, U (same alphabet as visit codes). */
export const PASS_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_RE = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${PASS_SECRET_LENGTH}}$`);

export const PASS_STATUSES = [
  'pending_payment',
  'active',
  'revoked',
  'refund_pending',
  'refunded',
] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];
/** Stored status plus "expired", which is computed from valid_to. */
export type EffectivePassStatus = PassStatus | 'expired';

export const SCAN_RESULTS = [
  'valid',
  'not_found',
  'not_paid',
  'expired',
  'revoked',
  'refunded',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

export const SCAN_FLAGS = ['many_places', 'rapid_repeat', 'too_many_today'] as const;
export type ScanFlag = (typeof SCAN_FLAGS)[number];

export const PAYMENT_STATUSES = ['created', 'captured', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const REFUND_STATUSES = ['pending', 'processed', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export function encodePassQr(secret: string): string {
  if (!SECRET_RE.test(secret)) throw new Error('Invalid pass secret');
  return `${PASS_QR_PREFIX}.${secret}`;
}

/** Scanned QR text or a typed code → the secret, or null if it is not a pass. */
export function parsePassInput(text: string): string | null {
  let s = text.trim().toUpperCase();
  if (s.startsWith(`${PASS_QR_PREFIX}.`)) s = s.slice(PASS_QR_PREFIX.length + 1);
  else if (s.includes('.')) return null;
  s = s.replace(/[\s-]/g, '');
  return SECRET_RE.test(s) ? s : null;
}

/** "K7Q2M9AB" → "DXP-K7Q2-M9AB" */
export function formatPassRef(ref: string): string {
  return `DXP-${ref.slice(0, 4)}-${ref.slice(4)}`;
}

/** Shops see only the last four digits (G9). */
export function passHolderMask(phoneE164: string): string {
  return /^\+\d{10,}$/.test(phoneE164) ? `••••••${phoneE164.slice(-4)}` : '••••••';
}

/**
 * End of validity: the season end (23:59 IST) by default, or a rolling window
 * of `validHours` from payment, never past the season end.
 */
export function passValidTo(paidAt: Date, seasonEnd: string, validHours: number | null): Date {
  const end = istInstant(seasonEnd, '23:59');
  if (!validHours) return end;
  const rolling = new Date(paidAt.getTime() + validHours * 3_600_000);
  return rolling < end ? rolling : end;
}

export function effectivePassStatus(
  pass: { status: PassStatus; validTo: Date | null },
  now = new Date(),
): EffectivePassStatus {
  if (pass.status === 'active' && pass.validTo && pass.validTo <= now) return 'expired';
  return pass.status;
}

/** Flag thresholds. A flagged scan is still valid; staff and admins are warned. */
export const FLAG_RULES = {
  manyPlaces: { places: 4, minutes: 60 },
  rapidRepeat: { scans: 3, minutes: 10 },
  perDay: 20,
} as const;

/**
 * Decides whether the scan about to be recorded should be flagged, given this
 * pass's earlier valid scans. `placeKey` is "shop:<id>" or "cluster:<id>".
 */
export function scanFlag(
  recent: { placeKey: string; at: Date }[],
  placeKey: string,
  now = new Date(),
): ScanFlag | null {
  const within = (min: number) => recent.filter((r) => now.getTime() - r.at.getTime() <= min * 60_000);

  const places = new Set(within(FLAG_RULES.manyPlaces.minutes).map((r) => r.placeKey));
  places.add(placeKey);
  if (places.size >= FLAG_RULES.manyPlaces.places) return 'many_places';

  const samePlace = within(FLAG_RULES.rapidRepeat.minutes).filter((r) => r.placeKey === placeKey);
  if (samePlace.length + 1 >= FLAG_RULES.rapidRepeat.scans) return 'rapid_repeat';

  const today = istDate(now);
  if (recent.filter((r) => istDate(r.at) === today).length + 1 >= FLAG_RULES.perDay) {
    return 'too_many_today';
  }
  return null;
}

// ---- API shapes ----

const iso = z.string();

export const passStatusSchema = z.enum([...PASS_STATUSES, 'expired']);
export const scanResultSchema = z.enum(SCAN_RESULTS);
export const scanFlagSchema = z.enum(SCAN_FLAGS);

/** What the customer sees. Never includes the secret (that comes from /qr). */
export const passSchema = z.object({
  id: z.string().uuid(),
  ref: z.string(),
  status: passStatusSchema,
  feePaise: z.number(),
  validFrom: iso.nullable(),
  validTo: iso.nullable(),
  createdAt: iso,
  /** set while a payment attempt is open */
  checkout: z
    .object({ provider: z.string(), checkoutId: z.string(), url: z.string() })
    .nullable(),
});
export type Pass = z.infer<typeof passSchema>;

export const currentPassResponseSchema = z.object({
  enabled: z.boolean(),
  feePaise: z.number(),
  pass: passSchema.nullable(),
});
export type CurrentPassResponse = z.infer<typeof currentPassResponseSchema>;

export const passQrResponseSchema = z.object({ passId: z.string().uuid(), qr: z.string() });
export type PassQrResponse = z.infer<typeof passQrResponseSchema>;

export const verifyPassSchema = z.object({ qr: z.string().trim().min(1).max(80) }).strict();
export type VerifyPass = z.input<typeof verifyPassSchema>;

export const verifyResultSchema = z.object({
  result: scanResultSchema,
  flag: scanFlagSchema.nullable(),
  pass: z
    .object({
      ref: z.string(),
      validTo: iso.nullable(),
      maskedPhone: z.string(),
      scansToday: z.number(),
    })
    .nullable(),
  scannedAt: iso,
});
export type VerifyResult = z.infer<typeof verifyResultSchema>;

export const scanRowSchema = z.object({
  id: z.string().uuid(),
  at: iso,
  result: scanResultSchema,
  flag: scanFlagSchema.nullable(),
  passRef: z.string().nullable(),
  place: z.string(),
});
export type ScanRow = z.infer<typeof scanRowSchema>;

export const mockCheckoutSchema = z.object({
  checkoutId: z.string(),
  amountPaise: z.number(),
  passRef: z.string(),
  status: z.enum(PAYMENT_STATUSES),
});
export type MockCheckout = z.infer<typeof mockCheckoutSchema>;

export const mockCompleteSchema = z.object({ outcome: z.enum(['success', 'fail']) }).strict();

export const adminPassSchema = z.object({
  id: z.string().uuid(),
  ref: z.string(),
  status: passStatusSchema,
  maskedPhone: z.string(),
  feePaise: z.number(),
  validTo: iso.nullable(),
  createdAt: iso,
  paidAt: iso.nullable(),
  scans: z.number(),
  flaggedScans: z.number(),
  payment: z
    .object({ provider: z.string(), providerPaymentId: z.string().nullable(), status: z.string() })
    .nullable(),
  refund: z.object({ status: z.string(), amountPaise: z.number() }).nullable(),
});
export type AdminPass = z.infer<typeof adminPassSchema>;

export const passActionSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export type PassAction = z.input<typeof passActionSchema>;

export const flaggedScanSchema = scanRowSchema.extend({ passId: z.string().uuid().nullable() });
export type FlaggedScan = z.infer<typeof flaggedScanSchema>;
