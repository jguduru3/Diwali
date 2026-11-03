// Growth program rules (agents and their payouts, merchant subscription, kits).
// Pure functions shared by the API, which enforces them (G3, G12, G13), and the web.
import { z } from 'zod';
import { istDate } from './time';

// ---- Money (integer paise) ----

/** Merchant season subscription: ₹1,999 + 18% GST (₹360), paid to the platform (G3). */
export const SUBSCRIPTION_PAISE = 199_900;
export const SUBSCRIPTION_GST_PAISE = 36_000;
export const SUBSCRIPTION_TOTAL_PAISE = SUBSCRIPTION_PAISE + SUBSCRIPTION_GST_PAISE;
/** One payment per merchant an agent sets up, once the shop is paid and live. */
export const AGENT_PAYOUT_PAISE = 100_000;
/** No TDS until this is earned in a financial year; 2% on the excess after it. */
export const TDS_THRESHOLD_PAISE = 2_000_000;
export const TDS_RATE_BASIS_POINTS = 200;
/** The app asks for a PAN once this is earned in the year. */
export const PAN_PROMPT_PAISE = 1_800_000;

// ---- Codes ----

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `DXA-7K3M9Q`: an agent's permanent code. */
export function generateCode(prefix: 'DXA', random: () => number = secureRandom): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CROCKFORD[Math.floor(random() * 32) % 32];
  return `${prefix}-${s}`;
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

// ---- Identity checks ----

export const isValidUpiId = (v: string) =>
  /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v.trim());
export const isValidPan = (v: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.trim().toUpperCase());

export const upiIdSchema = z.string().trim().refine(isValidUpiId, 'Enter a UPI ID like name@bank');
export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidPan, 'Enter the 10-character PAN');

// ---- Time ----

/** "2026-27": Indian financial year (1 April – 31 March, IST). */
export function financialYear(at: Date = new Date()): string {
  const d = istDate(at);
  const y = Number(d.slice(0, 4));
  const start = d.slice(5) >= '04-01' ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ---- Agent payouts: TDS and the PAN gate (approved by the CA, 3 November 2026) ----

/** A payout that would bring this year's earnings to ₹20,000 or more needs a PAN on file. */
export function payoutBlock(p: { fyEarnedPaise: number; hasPan: boolean }): 'pan_required' | null {
  return p.fyEarnedPaise >= TDS_THRESHOLD_PAISE && !p.hasPan ? 'pan_required' : null;
}

/** The app asks for the PAN from ₹18,000 earned in the year. */
export const panPrompt = (p: { fyEarnedPaise: number; hasPan: boolean }) =>
  !p.hasPan && p.fyEarnedPaise >= PAN_PROMPT_PAISE;

/**
 * TDS on a payout: 2% of the part of this year's earnings (this payout included) above ₹20,000
 * that has not been taxed yet, limited to the payout. `basePaise` is what this payout taxed.
 */
export function tdsFor(w: { fyEarnedPaise: number; taxedBasePaise: number; amountPaise: number }) {
  const untaxed = Math.max(0, w.fyEarnedPaise - TDS_THRESHOLD_PAISE - w.taxedBasePaise);
  const basePaise = Math.min(untaxed, w.amountPaise);
  return { tdsPaise: Math.round((basePaise * TDS_RATE_BASIS_POINTS) / 10_000), basePaise };
}

// ---- Merchant onboarding by an agent ----

export const ONBOARDING_STATUSES = [
  'draft',
  'consented',
  'setup',
  'review',
  'approved',
  'live',
  'closed',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

const ONBOARDING: Record<OnboardingStatus, readonly OnboardingStatus[]> = {
  draft: ['consented', 'closed'],
  consented: ['setup', 'closed'],
  setup: ['review', 'closed'],
  review: ['setup', 'approved', 'closed'],
  approved: ['live', 'closed'],
  live: ['setup', 'closed'],
  closed: [],
};

export const canOnboard = (from: OnboardingStatus, to: OnboardingStatus) =>
  ONBOARDING[from].includes(to);

/** What a shop needs before the agent can send it to the owner for approval. */
export const SUBMIT_MIN_PRODUCTS = 10;

// ---- Kits (same five types for every merchant) ----

export const KIT_TYPES = ['budget_1000', 'kit_2000', 'family', 'gift', 'special'] as const;
export type KitType = (typeof KIT_TYPES)[number];
export const ITEM_KINDS = ['product', 'kit'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const kitContentsSchema = z
  .array(
    z
      .object({ name: z.string().trim().min(1).max(60), qty: z.number().int().min(1).max(999) })
      .strict(),
  )
  .min(1)
  .max(40);
export type KitContents = z.infer<typeof kitContentsSchema>;

// ---- Terms (versioned; accepted in the app before the action they gate) ----

export const TERMS_PARTIES = ['customer', 'merchant', 'agent'] as const;
export type TermsParty = (typeof TERMS_PARTIES)[number];
export const TERMS_VERSIONS: Record<TermsParty, string> = {
  customer: '2026-11-v1',
  merchant: '2026-11-v1',
  /** v2: paid per shop straight to the agent's UPI ID (no wallet) */
  agent: '2026-11-v2',
};
