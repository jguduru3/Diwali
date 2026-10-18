import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { CONSENT_VERSION, meSchema, type Me } from '@pataka/shared';
import { api, ApiRequestError } from '../lib/api';

export const ME_KEY = ['me'] as const;

/**
 * Switches the cached account and drops every other user's data. Uses
 * resetQueries rather than clear(): clear() detaches mounted observers, so
 * screens would keep showing the previous account.
 */
export function switchAccount(qc: QueryClient, me: Me | null) {
  qc.setQueryData(ME_KEY, me);
  void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'demo' });
}

/** The signed-in account, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api('/me', { schema: meSchema });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (phone: string) => api('/auth/otp/request', { method: 'POST', body: { phone } }),
  });
}

export function useVerifyOtp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { phone: string; code: string }) =>
      api('/auth/otp/verify', {
        method: 'POST',
        body: { ...v, consentVersion: CONSENT_VERSION },
        schema: meSchema,
      }),
    onSuccess: (me) => switchAccount(qc, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => switchAccount(qc, null),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/me', { method: 'DELETE' }),
    onSuccess: () => switchAccount(qc, null),
  });
}

/** Only same-app paths are allowed as a post-login destination. */
export function safeNextPath(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}
