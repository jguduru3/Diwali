// Request bodies (strict) and responses for the growth program API.
import { z } from 'zod';
import { dateSchema } from './domain';
import {
  codeSchema,
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
    /** an influencer's DXI- code when they brought this agent */
    recruitCode: codeSchema.optional(),
    acceptTerms,
  })
  .strict();
export type AgentRegister = z.input<typeof agentRegisterSchema>;

export const influencerRegisterSchema = z
  .object({
    handle: z.string().trim().min(2).max(60),
    platform: z.enum(['instagram', 'youtube', 'facebook', 'whatsapp', 'other']),
    upiId: upiIdSchema,
    acceptTerms,
  })
  .strict();
export type InfluencerRegister = z.input<typeof influencerRegisterSchema>;

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

export const withdrawSchema = z.object({ amountPaise: z.number().int().positive() }).strict();
export const panSetSchema = z.object({ pan: panSchema }).strict();
export const claimReferralSchema = z.object({ code: codeSchema }).strict();
export const orderCreditSchema = z.object({ amountPaise: z.number().int().min(0) }).strict();
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

export const walletViewSchema = z.object({
  balancePaise: z.number(),
  todayRemainingPaise: z.number(),
  fyEarnedPaise: z.number(),
  fy: z.string(),
  panOnFile: z.boolean(),
  panRequired: z.boolean(),
  panPrompt: z.boolean(),
  frozen: z.boolean(),
  upiHint: z.string(),
  ledger: z.array(
    z.object({ id: z.string(), deltaPaise: z.number(), reason: z.string(), at: iso }),
  ),
  withdrawals: z.array(
    z.object({
      id: z.string(),
      amountPaise: z.number(),
      tdsPaise: z.number(),
      status: z.enum(['requested', 'sent', 'failed']),
      utr: z.string().nullable(),
      at: iso,
    }),
  ),
});
export type WalletView = z.infer<typeof walletViewSchema>;

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
  payout: z.enum(['none', 'credited', 'reversed']),
  feedbackGiven: z.boolean(),
  note: z.string().nullable(),
  updatedAt: iso,
});
export type MerchantDraft = z.infer<typeof merchantDraftSchema>;

export const agentMeSchema = z.object({
  code: z.string(),
  name: z.string(),
  status: z.enum(['pending', 'active', 'suspended']),
  merchants: z.array(merchantDraftSchema),
});
export type AgentMe = z.infer<typeof agentMeSchema>;

export const influencerMeSchema = z.object({
  code: z.string(),
  handle: z.string(),
  status: z.enum(['pending', 'active', 'suspended']),
  referred: z.number(),
  rewarded: z.number(),
  agentsRecruited: z.number(),
  visits: z.number(),
});
export type InfluencerMe = z.infer<typeof influencerMeSchema>;

export const creditViewSchema = z.object({
  balancePaise: z.number(),
  expiresOn: dateSchema,
  referralCode: z.string(),
  invited: z.number(),
  rewarded: z.number(),
  history: z.array(
    z.object({ id: z.string(), deltaPaise: z.number(), reason: z.string(), at: iso }),
  ),
});
export type CreditView = z.infer<typeof creditViewSchema>;

export const settlementSchema = z.object({
  id: z.string().uuid(),
  shopCode: z.string(),
  shopName: z.string(),
  mode: z.enum(['weekly', 'requested']),
  periodStart: dateSchema.nullable(),
  periodEnd: dateSchema.nullable(),
  amountPaise: z.number(),
  status: z.enum(['pending', 'paid']),
  upiHint: z.string().nullable(),
  utr: z.string().nullable(),
  bills: z.number(),
  createdAt: iso,
  paidAt: iso.nullable(),
});
export type Settlement = z.infer<typeof settlementSchema>;

export const shopSettlementsSchema = z.object({
  owedPaise: z.number(),
  canRequestToday: z.boolean(),
  settlements: z.array(settlementSchema),
});
export type ShopSettlements = z.infer<typeof shopSettlementsSchema>;

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
  influencer: z.enum(['pending', 'active', 'suspended']).nullable(),
  wallet: z.boolean(),
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
  recruitedBy: z.string().nullable(),
  createdAt: iso,
});
export const adminInfluencerSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  handle: z.string(),
  platform: z.string(),
  status: z.enum(['pending', 'active', 'suspended']),
  referred: z.number(),
  createdAt: iso,
});
export const adminWithdrawalSchema = z.object({
  id: z.string().uuid(),
  walletId: z.string().uuid(),
  who: z.string(),
  upiHint: z.string(),
  amountPaise: z.number(),
  tdsPaise: z.number(),
  payPaise: z.number(),
  status: z.enum(['requested', 'sent', 'failed']),
  utr: z.string().nullable(),
  createdAt: iso,
});
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
