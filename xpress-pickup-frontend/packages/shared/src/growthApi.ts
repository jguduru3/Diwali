// Request bodies (strict) and responses for the growth program API: agents (gig workers),
// merchant onboarding and subscription, agent payouts, kits, terms and notices.
import { z } from 'zod';
import {
  INDUCTION_VERSION,
  KIT_TYPES,
  ONBOARDING_STATUSES,
  panSchema,
  TERMS_PARTIES,
  upiIdSchema,
} from './growth';
import { phoneSchema } from './schemas';

const iso = z.string();
const acceptTerms = z.literal(true, { errorMap: () => ({ message: 'Accept the terms first' }) });

// ---- Requests ----

export const agentRegisterSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    upiId: upiIdSchema,
    acceptTerms,
    /** the induction version the agent finished; registering needs the current one */
    inductionVersion: z.literal(INDUCTION_VERSION),
  })
  .strict();
export type AgentRegister = z.input<typeof agentRegisterSchema>;

export const newMerchantSchema = z
  .object({
    shopName: z.string().trim().min(2).max(80),
    area: z.string().trim().min(2).max(60),
    ownerName: z.string().trim().min(2).max(80),
    ownerPhone: phoneSchema,
  })
  .strict();
export type NewMerchant = z.input<typeof newMerchantSchema>;

export const consentCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const merchantSetupSchema = z
  .object({
    address: z.string().trim().max(200).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    gstin: z.string().trim().toUpperCase().optional(),
    openFrom: time.optional(),
    openTo: time.optional(),
  })
  .strict();
export type MerchantSetup = z.input<typeof merchantSetupSchema>;

export const agentFeedbackSchema = z
  .object({ helped: z.boolean(), note: z.string().trim().max(300).optional() })
  .strict();

export const reviewApproveSchema = z
  .object({ acceptTerms, method: z.enum(['online', 'offline']) })
  .strict();
export const reviewNoteSchema = z.object({ note: z.string().trim().min(3).max(500) }).strict();

export const panSetSchema = z.object({ pan: panSchema }).strict();
/** The agent changes the UPI ID their payouts go to (for example after a failed transfer). */
export const agentUpiSchema = z.object({ upiId: upiIdSchema }).strict();
export const utrSchema = z
  .object({
    utr: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z]{6,30}$/, 'Enter the UTR / reference'),
  })
  .strict();
export const growthReasonSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const offlinePaidSchema = z.object({ reference: z.string().trim().min(4).max(60) }).strict();
export const termsAcceptSchema = z.object({ party: z.enum(TERMS_PARTIES) }).strict();

// ---- Responses ----

export const merchantDraftSchema = z.object({
  id: z.string().uuid(),
  shopCode: z.string(),
  shopName: z.string(),
  area: z.string(),
  ownerName: z.string().nullable(),
  ownerPhoneMasked: z.string(),
  status: z.enum(ONBOARDING_STATUSES),
  consented: z.boolean(),
  /** what is still missing before submit */
  missing: z.array(z.string()),
  /** link to send the owner (WhatsApp / SMS), while it is valid */
  ownerLink: z.string().nullable(),
  payout: z.enum(['none', 'pending', 'sent', 'failed', 'reversed']),
  feedbackGiven: z.boolean(),
  note: z.string().nullable(),
  updatedAt: iso,
});
export type MerchantDraft = z.infer<typeof merchantDraftSchema>;

export const payoutStatusSchema = z.enum(['pending', 'sent', 'failed', 'reversed']);
export const agentPayoutSchema = z.object({
  id: z.string().uuid(),
  shopName: z.string(),
  amountPaise: z.number(),
  tdsPaise: z.number(),
  /** what reaches the agent's UPI ID: amount − TDS */
  netPaise: z.number(),
  status: payoutStatusSchema,
  utr: z.string().nullable(),
  /** why a pending payout cannot be sent yet */
  blocked: z.enum(['pan_required']).nullable(),
  failureReason: z.string().nullable(),
  earnedAt: iso,
  sentAt: iso.nullable(),
});
export type AgentPayout = z.infer<typeof agentPayoutSchema>;

export const agentMeSchema = z.object({
  code: z.string(),
  name: z.string(),
  status: z.enum(['pending', 'active', 'suspended']),
  merchants: z.array(merchantDraftSchema),
  /** where payouts go (hint only; the full UPI ID stays encrypted) */
  upiHint: z.string(),
  fy: z.string(),
  /** earned this financial year, reversals excluded (TDS and the PAN gate use it) */
  fyEarnedPaise: z.number(),
  paidPaise: z.number(),
  pendingPaise: z.number(),
  panOnFile: z.boolean(),
  panPrompt: z.boolean(),
  panRequired: z.boolean(),
  payouts: z.array(agentPayoutSchema),
});
export type AgentMe = z.infer<typeof agentMeSchema>;

export const reviewPageSchema = z.object({
  shopName: z.string(),
  area: z.string(),
  ownerName: z.string().nullable(),
  agentCode: z.string().nullable(),
  status: z.enum(ONBOARDING_STATUSES),
  gstin: z.string().nullable(),
  openFrom: z.string().nullable(),
  openTo: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      packDesc: z.string().nullable(),
      pricePaise: z.number(),
      imageUrl: z.string().nullable(),
    }),
  ),
  amountPaise: z.number(),
  gstPaise: z.number(),
  subscription: z
    .object({
      status: z.enum(['pending', 'paid', 'refunded', 'cancelled']),
      method: z.enum(['online', 'offline']),
      checkoutUrl: z.string().nullable(),
      reference: z.string(),
    })
    .nullable(),
});
export type ReviewPage = z.infer<typeof reviewPageSchema>;

export const kitTypeSummarySchema = z.object({
  type: z.enum(KIT_TYPES),
  shops: z.number(),
  fromPaise: z.number().nullable(),
});
export const kitOfferSchema = z.object({
  shopCode: z.string(),
  shopName: z.string(),
  area: z.string(),
  distanceKm: z.number().nullable(),
  itemId: z.string().uuid(),
  /** what the customer's order list stores for this shop */
  itemNo: z.number().int(),
  priceVersion: z.number().int(),
  name: z.string(),
  pricePaise: z.number(),
  imageUrl: z.string().nullable(),
  contents: z.array(z.object({ name: z.string(), qty: z.number() })),
});
export type KitOffer = z.infer<typeof kitOfferSchema>;

export const termsStatusSchema = z.object({
  versions: z.record(z.string()),
  accepted: z.array(z.object({ party: z.string(), version: z.string() })),
});

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  params: z.record(z.unknown()).nullable(),
  read: z.boolean(),
  at: iso,
});
export type AppNotification = z.infer<typeof notificationSchema>;

export const roleProfilesSchema = z.object({
  agent: z.enum(['pending', 'active', 'suspended']).nullable(),
});
export type RoleProfiles = z.infer<typeof roleProfilesSchema>;

// ---- Admin ----

export const adminAgentSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  phoneMasked: z.string(),
  status: z.enum(['pending', 'active', 'suspended']),
  merchants: z.number(),
  live: z.number(),
  createdAt: iso,
});
export const adminPayoutSchema = z.object({
  id: z.string().uuid(),
  agentCode: z.string(),
  agentName: z.string(),
  phoneMasked: z.string(),
  upiHint: z.string(),
  shopCode: z.string(),
  shopName: z.string(),
  amountPaise: z.number(),
  tdsPaise: z.number(),
  netPaise: z.number(),
  status: payoutStatusSchema,
  utr: z.string().nullable(),
  blocked: z.enum(['pan_required']).nullable(),
  failureReason: z.string().nullable(),
  failedAttempts: z.number(),
  earnedAt: iso,
});
export type AdminPayout = z.infer<typeof adminPayoutSchema>;
export const adminSubscriptionSchema = z.object({
  id: z.string().uuid(),
  shopCode: z.string(),
  shopName: z.string(),
  method: z.enum(['online', 'offline']),
  status: z.enum(['pending', 'paid', 'refunded', 'cancelled']),
  totalPaise: z.number(),
  reference: z.string(),
  invoiceNo: z.string().nullable(),
  createdAt: iso,
});
export const adminFeedbackSchema = z.object({
  agentCode: z.string(),
  shopCode: z.string(),
  helped: z.boolean(),
  note: z.string().nullable(),
  at: iso,
});
