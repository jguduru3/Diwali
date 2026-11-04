// Data hooks for the growth program: agents and their payouts, owner links, kits, terms and the
// admin screens. Every response is checked with the shared schema.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  adminAgentSchema,
  adminFeedbackSchema,
  adminPayoutSchema,
  adminSubscriptionSchema,
  agentMeSchema,
  kitOfferSchema,
  kitTypeSummarySchema,
  merchantDraftSchema,
  notificationSchema,
  reviewPageSchema,
  roleProfilesSchema,
  termsStatusSchema,
  type AgentRegister,
  type KitType,
  type MerchantSetup,
  type NewMerchant,
  type TermsParty,
} from '@pataka/shared';
import { useMe } from '../auth/useAuth';
import { api } from './api';

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
    [['agentMe'], ['profiles']],
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

// ---- Agent payout details ----

export const useAgentPan = () =>
  useAct(
    (pan: string) => api('/agent/pan', { method: 'POST', body: { pan }, schema: agentMeSchema }),
    [['agentMe']],
  );

export const useAgentUpi = () =>
  useAct(
    (upiId: string) => api('/agent/upi', { method: 'PUT', body: { upiId }, schema: agentMeSchema }),
    [['agentMe']],
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
export const useAdminSubscriptions = list(
  'adminSubscriptions',
  '/console/subscriptions',
  adminSubscriptionSchema,
);
export const useAdminPayouts = list('adminPayouts', '/console/payouts', adminPayoutSchema);
export const useAdminFeedback = () =>
  useQuery({
    queryKey: ['adminFeedback'],
    queryFn: () => api('/console/agent-feedback', { schema: z.array(adminFeedbackSchema) }),
  });
/** One admin action: POST /console/{path} with a body; refreshes the given lists. */
export const useAdminAct = () =>
  useAct(
    ({ path, body }: { path: string; body?: unknown }) =>
      api(`/console/${path}`, { method: 'POST', body: body ?? {} }),
    [['adminAgents'], ['adminPayouts'], ['adminSubscriptions'], ['adminFeedback']],
  );
