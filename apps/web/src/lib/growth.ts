// Data hooks for the growth program: agents, influencers, wallets, credit and referrals, owner
// links, kits, settlements, terms and the admin screens. Every response is checked with the
// shared schema.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  adminAgentSchema,
  adminFeedbackSchema,
  adminInfluencerSchema,
  adminSubscriptionSchema,
  adminWithdrawalSchema,
  agentMeSchema,
  creditViewSchema,
  influencerMeSchema,
  kitOfferSchema,
  kitTypeSummarySchema,
  merchantDraftSchema,
  notificationSchema,
  reviewPageSchema,
  roleProfilesSchema,
  settlementSchema,
  shopSettlementsSchema,
  termsStatusSchema,
  walletViewSchema,
  type AgentRegister,
  type InfluencerRegister,
  type KitType,
  type MerchantSetup,
  type NewMerchant,
  type TermsParty,
} from '@pataka/shared';
import { useMe } from '../auth/useAuth';
import { api } from './api';
import { useShopScope } from './queries';

const useSignedIn = () => !!useMe().data;

function useAct<TBody, TOut>(fn: (b: TBody) => Promise<TOut>, invalidate: string[][]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k })),
  });
}

// ---- Me ----

export const useProfiles = () => {
  const enabled = useSignedIn();
  return useQuery({
    enabled,
    queryKey: ['profiles'],
    queryFn: () => api('/me/profiles', { schema: roleProfilesSchema }),
  });
};

export const useCredit = () =>
  useQuery({
    queryKey: ['credit'],
    queryFn: () => api('/me/credit', { schema: creditViewSchema }),
  });

export const useClaimReferral = () =>
  useAct(
    (code: string) => api('/referrals/claim', { method: 'POST', body: { code } }),
    [['credit']],
  );

export const useOrderCredit = () =>
  useAct(
    ({ orderId, amountPaise }: { orderId: string; amountPaise: number }) =>
      api(`/orders/${orderId}/credit`, { method: 'POST', body: { amountPaise } }),
    [['order'], ['credit']],
  );

export const useTerms = () =>
  useQuery({ queryKey: ['terms'], queryFn: () => api('/terms', { schema: termsStatusSchema }) });

export const useAcceptTerms = () =>
  useAct(
    (party: TermsParty) => api('/terms/accept', { method: 'POST', body: { party } }),
    [['terms']],
  );

export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api('/notifications', { schema: z.array(notificationSchema) }),
    refetchInterval: 30_000,
  });

// ---- Kits ----

export const useKitTypes = () =>
  useQuery({
    queryKey: ['kits'],
    queryFn: () => api('/kits', { schema: z.array(kitTypeSummarySchema) }),
  });

export const useKitOffers = (type: KitType, pos: { lat: number; lng: number } | null) =>
  useQuery({
    queryKey: ['kits', type, pos],
    queryFn: () =>
      api(`/kits/${type}${pos ? `?lat=${pos.lat}&lng=${pos.lng}` : ''}`, {
        schema: z.array(kitOfferSchema),
      }),
  });

// ---- Agents ----

export const useAgentMe = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['agentMe'],
    queryFn: () => api('/agent/me', { schema: agentMeSchema }),
    retry: false,
  });

export const useAgentRegister = () =>
  useAct(
    (b: AgentRegister) =>
      api('/agent/register', { method: 'POST', body: b, schema: agentMeSchema }),
    [['agentMe'], ['profiles'], ['wallet']],
  );

export const useNewMerchant = () =>
  useAct(
    (b: NewMerchant) =>
      api('/agent/merchants/new', { method: 'POST', body: b, schema: merchantDraftSchema }),
    [['agentMe']],
  );

export const useMerchantAction = () =>
  useAct(
    ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'consent' | 'resend' | 'submit' | 'feedback' | 'setup';
      body?: unknown;
    }) =>
      api(`/agent/merchants/${id}/${action}`, {
        method: action === 'setup' ? 'PUT' : 'POST',
        body: body ?? {},
        schema: merchantDraftSchema,
      }),
    [['agentMe']],
  );

export type SetupBody = MerchantSetup;

// ---- Influencers and wallets ----

export const useInfluencerMe = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['influencerMe'],
    queryFn: () => api('/influencer/me', { schema: influencerMeSchema }),
    retry: false,
  });

export const useInfluencerRegister = () =>
  useAct(
    (b: InfluencerRegister) =>
      api('/influencer/register', { method: 'POST', body: b, schema: influencerMeSchema }),
    [['influencerMe'], ['profiles'], ['wallet']],
  );

export const useWallet = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['wallet'],
    queryFn: () => api('/wallet', { schema: walletViewSchema }),
    retry: false,
  });

export const useWithdraw = () =>
  useAct(
    ({ amountPaise, key }: { amountPaise: number; key: string }) =>
      api('/wallet/withdraw', {
        method: 'POST',
        body: { amountPaise },
        headers: { 'Idempotency-Key': key },
        schema: walletViewSchema,
      }),
    [['wallet']],
  );

export const useSetPan = () =>
  useAct(
    (pan: string) =>
      api('/wallet/pan', { method: 'POST', body: { pan }, schema: walletViewSchema }),
    [['wallet']],
  );

// ---- Owner links ----

export const useReview = (token: string) =>
  useQuery({
    queryKey: ['review', token],
    queryFn: () => api(`/m/review/${token}`, { schema: reviewPageSchema }),
    retry: false,
  });

export const useReviewAct = (token: string) =>
  useAct(
    ({ kind, body }: { kind: 'approve' | 'changes' | 'decline' | 'report'; body: unknown }) =>
      api(`/m/review/${token}/${kind}`, { method: 'POST', body }),
    [['review', token]],
  );

export const useOwnerApprove = () =>
  useMutation({
    mutationFn: (token: string) => api(`/m/approve/${token}`, { method: 'POST', body: {} }),
  });

// ---- Shop: settlements ----

export function useShopSettlements() {
  const s = useShopScope();
  return useQuery({
    queryKey: ['shopSettlements', s.code],
    queryFn: () => api(`/shop/settlements${s.q()}`, { schema: shopSettlementsSchema }),
  });
}

export function useRequestSettlement() {
  const s = useShopScope();
  return useAct(
    () =>
      api(`/shop/settlements/request${s.q()}`, { method: 'POST', schema: shopSettlementsSchema }),
    [['shopSettlements']],
  );
}

// ---- Admin ----

const list =
  <T>(key: string, path: string, schema: z.ZodType<T>) =>
  (status = '') =>
    useQuery({
      queryKey: [key, status],
      queryFn: () =>
        api(`${path}${status ? `?status=${status}` : ''}`, { schema: z.array(schema) }),
    });

export const useAdminAgents = list('adminAgents', '/console/agents', adminAgentSchema);
export const useAdminInfluencers = list(
  'adminInfluencers',
  '/console/influencers',
  adminInfluencerSchema,
);
export const useAdminWithdrawals = list(
  'adminWithdrawals',
  '/console/withdrawals',
  adminWithdrawalSchema,
);
export const useAdminSettlements = list(
  'adminSettlements',
  '/console/settlements',
  settlementSchema,
);
export const useAdminSubscriptions = list(
  'adminSubscriptions',
  '/console/subscriptions',
  adminSubscriptionSchema,
);
export const useAdminFeedback = () =>
  useQuery({
    queryKey: ['adminFeedback'],
    queryFn: () => api('/console/agent-feedback', { schema: z.array(adminFeedbackSchema) }),
  });
export const useAdminPayouts = () =>
  useQuery({
    queryKey: ['adminPayouts'],
    queryFn: () =>
      api('/console/payouts', {
        schema: z.array(
          z.object({
            id: z.string(),
            agentCode: z.string(),
            shopCode: z.string(),
            amountPaise: z.number(),
            status: z.enum(['credited', 'reversed']),
            at: z.string(),
          }),
        ),
      }),
  });

/** One admin action: POST /console/{path} with a body; refreshes the given lists. */
export const useAdminAct = () =>
  useAct(
    ({ path, body }: { path: string; body?: unknown }) =>
      api(`/console/${path}`, { method: 'POST', body: body ?? {} }),
    [
      ['adminAgents'],
      ['adminInfluencers'],
      ['adminWithdrawals'],
      ['adminSettlements'],
      ['adminSubscriptions'],
      ['adminPayouts'],
    ],
  );
