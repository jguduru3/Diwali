// Growth program rules (agents, influencers, referrals, wallets, merchant subscription, kits).
// Pure functions shared by the API, which enforces them (G3, G12, G13), and the web.
import { z } from 'zod';
import { addDays, istDate } from './time';

// ---- Money (integer paise) ----

/** Merchant season subscription: ₹1,999 + 18% GST (₹360), paid to the platform (G3). */
export const SUBSCRIPTION_PAISE = 199_900;
export const SUBSCRIPTION_GST_PAISE = 36_000;
export const SUBSCRIPTION_TOTAL_PAISE = SUBSCRIPTION_PAISE + SUBSCRIPTION_GST_PAISE;
/** One payment per merchant an agent sets up, once the shop is paid and live. */
export const AGENT_PAYOUT_PAISE = 100_000;
/** Every successful referral, for customers (credit) and influencers (wallet money). */
export const REFERRAL_REWARD_PAISE = 1_000;
/** Influencer bonus when an agent they brought sets up their first live merchant. */
export const RECRUIT_REWARD_PAISE = 1_000;
export const DAILY_WITHDRAWAL_CAP_PAISE = 200_000;
/** No TDS until this is earned in a financial year; 2% on the excess after it. */
export const TDS_THRESHOLD_PAISE = 2_000_000;
export const TDS_RATE_BASIS_POINTS = 200;
/** The app asks for a PAN once this is earned in the year. */
export const PAN_PROMPT_PAISE = 1_800_000;
/** Failed payout transfers before a wallet is frozen for review. */
export const MAX_FAILED_TRANSFERS = 3;

// ---- Codes ----

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `DXA-7K3M9Q` (agent), `DXI-…` (influencer), `DXR-…` (customer referral). */
export function generateCode(
  prefix: 'DXA' | 'DXI' | 'DXR',
  random: () => number = secureRandom,
): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CROCKFORD[Math.floor(random() * 32) % 32];
  return `${prefix}-${s}`;
}

export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^DX[AIR]-[0-9A-HJKMNP-TV-Z]{6}$/, 'Not a valid code');

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

/** The last full Monday–Sunday week (IST) before `at`, as YYYY-MM-DD dates. */
export function previousWeek(at: Date = new Date()): { start: string; end: string } {
  const today = istDate(at);
  const dow = new Date(`${today}T12:00:00+05:30`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const thisMonday = addDays(today, -sinceMonday);
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

// ---- Wallet rules ----

export type WithdrawalError = 'amount' | 'balance' | 'daily_cap' | 'frozen' | 'pan_required';

/** Whether a withdrawal may go ahead: balance, ₹2,000/day cap, freeze and the PAN gate. */
export function withdrawalCheck(w: {
  balancePaise: number;
  amountPaise: number;
  /** requested + sent today (IST) */
  todayPaise: number;
  fyEarnedPaise: number;
  hasPan: boolean;
  frozen: boolean;
}): { ok: true } | { ok: false; code: WithdrawalError } {
  if (!Number.isInteger(w.amountPaise) || w.amountPaise <= 0) return { ok: false, code: 'amount' };
  if (w.frozen) return { ok: false, code: 'frozen' };
  if (w.amountPaise > w.balancePaise) return { ok: false, code: 'balance' };
  if (w.todayPaise + w.amountPaise > DAILY_WITHDRAWAL_CAP_PAISE) {
    return { ok: false, code: 'daily_cap' };
  }
  if (w.fyEarnedPaise >= TDS_THRESHOLD_PAISE && !w.hasPan) {
    return { ok: false, code: 'pan_required' };
  }
  return { ok: true };
}

/**
 * TDS on a withdrawal: 2% of the part of this year's earnings above ₹20,000 that has not
 * been taxed yet, limited to the amount withdrawn. `basePaise` is what this withdrawal taxed.
 */
export function tdsFor(w: { fyEarnedPaise: number; taxedBasePaise: number; amountPaise: number }) {
  const untaxed = Math.max(0, w.fyEarnedPaise - TDS_THRESHOLD_PAISE - w.taxedBasePaise);
  const basePaise = Math.min(untaxed, w.amountPaise);
  return { tdsPaise: Math.round((basePaise * TDS_RATE_BASIS_POINTS) / 10_000), basePaise };
}

/** Credit applied to a bill: never more than the bill or the balance (G11). */
export function maxRedeemable(billPaise: number, balancePaise: number): number {
  return Math.max(0, Math.min(billPaise, balancePaise));
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

export const TERMS_PARTIES = ['customer', 'merchant', 'agent', 'influencer', 'referral'] as const;
export type TermsParty = (typeof TERMS_PARTIES)[number];
export const TERMS_VERSIONS: Record<TermsParty, string> = {
  customer: '2026-11-v1',
  merchant: '2026-11-v1',
  agent: '2026-11-v1',
  influencer: '2026-11-v1',
  referral: '2026-11-v1',
};
