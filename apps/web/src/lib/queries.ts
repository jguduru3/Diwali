import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  adminClusterSchema,
  adminShopSchema,
  areaSchema,
  blockedUserSchema,
  categorySchema,
  currentVisitResponseSchema,
  demoInfoSchema,
  footfallRowSchema,
  gateCheckinResultSchema,
  gateTodaySchema,
  itemSchema,
  itemsResponseSchema,
  licenceSchema,
  meSchema,
  metricsRowSchema,
  queueVisitSchema,
  shopContextSchema,
  shopDetailSchema,
  shopSummarySchema,
  shopTodaySchema,
  slotSchema,
  visitSchema,
  type CategoryInput,
  type ClusterInput,
  type CreateVisit,
  type DaySlots,
  type GateCheckin,
  type ItemInput,
  type ItemPatch,
  type LicenceSubmit,
  type ShopInput,
  type ShopPatch,
  type ShopSettings,
} from '@pataka/shared';
import { switchAccount, useMe } from '../auth/useAuth';
import { api } from './api';
import { saveTicket } from './ticketStore';

const daySlotsResponse = z.object({
  date: z.string(),
  dates: z.array(z.string()),
  slots: z.array(slotSchema),
});

// ---- Public ----

export const useAreas = () =>
  useQuery({ queryKey: ['areas'], queryFn: () => api('/areas', { schema: z.array(areaSchema) }) });

export function useShops(params: { area?: string; lat?: number; lng?: number }) {
  const qs = new URLSearchParams();
  if (params.area) qs.set('area', params.area);
  if (params.lat !== undefined && params.lng !== undefined) {
    qs.set('lat', String(params.lat));
    qs.set('lng', String(params.lng));
  }
  return useQuery({
    queryKey: ['shops', params],
    queryFn: () => api(`/shops?${qs}`, { schema: z.array(shopSummarySchema) }),
  });
}

export const useShop = (code: string) =>
  useQuery({
    queryKey: ['shop', code],
    queryFn: () => api(`/shops/${code}`, { schema: shopDetailSchema }),
  });

export const useShopItems = (code: string) =>
  useQuery({
    queryKey: ['shopItems', code],
    queryFn: () => api(`/shops/${code}/items`, { schema: itemsResponseSchema }),
  });

export const useShopSlots = (code: string, date: string | undefined) =>
  useQuery({
    queryKey: ['shopSlots', code, date],
    queryFn: () =>
      api(`/shops/${code}/slots${date ? `?date=${date}` : ''}`, { schema: daySlotsResponse }),
    refetchInterval: 30_000,
  });

// ---- Customer ----

export function useCurrentVisit(enabled: boolean) {
  return useQuery({
    queryKey: ['currentVisit'],
    queryFn: async () => {
      const { visit } = await api('/visits/current', { schema: currentVisitResponseSchema });
      saveTicket(visit);
      return visit;
    },
    enabled,
    refetchInterval: 20_000,
  });
}

export function useBookVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVisit) =>
      api('/visits', { method: 'POST', body, schema: visitSchema }),
    onSuccess: (visit) => {
      saveTicket(visit);
      qc.setQueryData(['currentVisit'], visit);
      void qc.invalidateQueries({ queryKey: ['shopSlots'] });
      void qc.invalidateQueries({ queryKey: ['shops'] });
    },
  });
}

export function useCancelVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api(`/visits/${code}/cancel`, { method: 'POST', schema: visitSchema }),
    onSuccess: () => {
      saveTicket(null);
      qc.setQueryData(['currentVisit'], null);
      void qc.invalidateQueries({ queryKey: ['shopSlots'] });
    },
  });
}

// ---- Demo ----

export const useDemoInfo = () =>
  useQuery({
    queryKey: ['demo'],
    queryFn: () => api('/auth/demo', { schema: demoInfoSchema }),
    staleTime: 5 * 60_000,
  });

export function useDemoLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) =>
      api('/auth/demo/login', { method: 'POST', body: { phone }, schema: meSchema }),
    onSuccess: (me) => switchAccount(qc, me),
  });
}

// ---- Admin scope pickers (admins choose which shop / cluster to operate) ----

function scopeStore(key: string) {
  const listeners = new Set<() => void>();
  const get = () => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  };
  const set = (v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      // ignore
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  return { get, set, subscribe };
}
const shopScope = scopeStore('pp.adminShop');
const clusterScope = scopeStore('pp.adminCluster');

/** Query-string suffix for shop-app calls: admins add ?shop=CODE. */
export function useShopScope() {
  const { data: me } = useMe();
  const chosen = useSyncExternalStore(shopScope.subscribe, shopScope.get, () => '');
  const isAdmin = me?.role === 'admin';
  const code = isAdmin ? chosen : '';
  const choose = useCallback((v: string) => shopScope.set(v), []);
  return { isAdmin, code, choose, q: (sep: '?' | '&' = '?') => (code ? `${sep}shop=${code}` : '') };
}

export function useClusterScope() {
  const { data: me } = useMe();
  const chosen = useSyncExternalStore(clusterScope.subscribe, clusterScope.get, () => '');
  const isAdmin = me?.role === 'admin';
  const id = isAdmin ? chosen : '';
  const choose = useCallback((v: string) => clusterScope.set(v), []);
  return { isAdmin, id, choose, q: (sep: '?' | '&' = '?') => (id ? `${sep}cluster=${id}` : '') };
}

// ---- Shop app ----

export function useShopContext() {
  const s = useShopScope();
  return useQuery({
    queryKey: ['shopCtx', s.code],
    queryFn: () => api(`/shop/context${s.q()}`, { schema: shopContextSchema }),
  });
}

const shopItemsAdmin = z.object({
  shopCode: z.string(),
  priceVersion: z.number(),
  categories: z.array(categorySchema),
  items: z.array(itemSchema),
});

export function useOwnItems() {
  const s = useShopScope();
  return useQuery({
    queryKey: ['ownItems', s.code],
    queryFn: () => api(`/shop/items${s.q()}`, { schema: shopItemsAdmin }),
    // Keep the price list for offline counter use (SPEC §15).
    staleTime: 30_000,
    gcTime: 24 * 3_600_000,
  });
}

function useShopMutation<TBody, TOut>(
  fn: (q: string, body: TBody) => Promise<TOut>,
  invalidate: string[][],
) {
  const qc = useQueryClient();
  const s = useShopScope();
  return useMutation({
    mutationFn: (body: TBody) => fn(s.q(), body),
    onSuccess: () => invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k })),
  });
}

export const useCreateItem = () =>
  useShopMutation(
    (q, body: ItemInput) =>
      api(`/shop/items/new${q}`, { method: 'POST', body, schema: itemSchema }),
    [['ownItems'], ['shopCtx']],
  );

export const usePatchItem = () =>
  useShopMutation(
    (q, { id, patch }: { id: string; patch: ItemPatch }) =>
      api(`/shop/items/${id}${q}`, { method: 'PATCH', body: patch, schema: itemSchema }),
    [['ownItems'], ['shopCtx']],
  );

export const useSoldOut = () =>
  useShopMutation(
    (q, { id, isSoldOut }: { id: string; isSoldOut: boolean }) =>
      api(`/shop/items/${id}/sold-out${q}`, {
        method: 'PATCH',
        body: { isSoldOut },
        schema: itemSchema,
      }),
    [['ownItems'], ['shopCtx']],
  );

export const useSaveSettings = () =>
  useShopMutation(
    (q, body: ShopSettings) =>
      api(`/shop/settings${q}`, { method: 'PUT', body, schema: shopContextSchema }),
    [['shopCtx'], ['ownSlots']],
  );

export function useOwnSlots(date: string | undefined) {
  const s = useShopScope();
  return useQuery({
    queryKey: ['ownSlots', s.code, date],
    queryFn: () =>
      api(`/shop/slots?${date ? `date=${date}` : ''}${s.q('&')}`, { schema: daySlotsResponse }),
  });
}

export const useSaveDaySlots = () =>
  useShopMutation(
    (q, body: DaySlots) =>
      api(`/shop/slots/day${q}`, { method: 'PUT', body, schema: daySlotsResponse }),
    [['ownSlots']],
  );

export const useSlotCapacity = () =>
  useShopMutation(
    (q, { id, capacity }: { id: string; capacity: number }) =>
      api(`/shop/slots/${id}${q}`, { method: 'PATCH', body: { capacity }, schema: slotSchema }),
    [['ownSlots']],
  );

export function useShopToday(date?: string) {
  const s = useShopScope();
  return useQuery({
    queryKey: ['shopToday', s.code, date],
    queryFn: () =>
      api(`/shop/visits/today?${date ? `date=${date}` : ''}${s.q('&')}`, {
        schema: shopTodaySchema,
      }),
    refetchInterval: 10_000, // SPEC §3: shop screens poll every 10 s
  });
}

export const useServe = () =>
  useShopMutation(
    (q, code: string) =>
      api(`/shop/visits/${code}/serve${q}`, { method: 'POST', schema: queueVisitSchema }),
    [['shopToday']],
  );

export const useNoShow = () =>
  useShopMutation(
    (q, code: string) =>
      api(`/shop/visits/${code}/no-show${q}`, { method: 'POST', schema: queueVisitSchema }),
    [['shopToday']],
  );

export function useShopStats() {
  const s = useShopScope();
  return useQuery({
    queryKey: ['shopStats', s.code],
    queryFn: () =>
      api(`/shop/stats${s.q()}`, {
        schema: z.object({ from: z.string(), to: z.string(), rows: z.array(footfallRowSchema) }),
      }),
  });
}

export function useOwnLicences() {
  const s = useShopScope();
  return useQuery({
    queryKey: ['ownLicences', s.code],
    queryFn: () => api(`/shop/licence${s.q()}`, { schema: z.array(licenceSchema) }),
  });
}

export const useSubmitLicence = () =>
  useShopMutation(
    (q, body: LicenceSubmit) =>
      api(`/shop/licence/new${q}`, { method: 'POST', body, schema: licenceSchema }),
    [['ownLicences'], ['shopCtx']],
  );

// ---- Gate ----

export function useGateToday() {
  const c = useClusterScope();
  return useQuery({
    queryKey: ['gateToday', c.id],
    queryFn: () => api(`/gate/today${c.q()}`, { schema: gateTodaySchema }),
    refetchInterval: 10_000,
  });
}

export function useCheckin() {
  const qc = useQueryClient();
  const c = useClusterScope();
  return useMutation({
    mutationFn: (body: GateCheckin) =>
      api(`/gate/checkin${c.q()}`, { method: 'POST', body, schema: gateCheckinResultSchema }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['gateToday'] }),
  });
}

// ---- Admin console ----

export const useAdminClusters = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['adminClusters'],
    queryFn: () => api('/console/clusters', { schema: z.array(adminClusterSchema) }),
  });

export const useAdminShops = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['adminShops'],
    queryFn: () => api('/console/shops', { schema: z.array(adminShopSchema) }),
  });

export const useAdminCategories = () =>
  useQuery({
    queryKey: ['adminCategories'],
    queryFn: () => api('/console/categories', { schema: z.array(categorySchema) }),
  });

export const useAdminLicences = (status: string) =>
  useQuery({
    queryKey: ['adminLicences', status],
    queryFn: () =>
      api(`/console/licences${status ? `?status=${status}` : ''}`, {
        schema: z.array(licenceSchema),
      }),
  });

export const useBlocked = () =>
  useQuery({
    queryKey: ['blocked'],
    queryFn: () => api('/console/users/blocked', { schema: z.array(blockedUserSchema) }),
  });

export const useMetrics = () =>
  useQuery({
    queryKey: ['metrics'],
    queryFn: () =>
      api('/console/metrics', {
        schema: z.object({
          from: z.string(),
          to: z.string(),
          visibleShops: z.number(),
          totalShops: z.number(),
          rows: z.array(metricsRowSchema),
        }),
      }),
    refetchInterval: 30_000,
  });

function useAdminMutation<TBody>(fn: (body: TBody) => Promise<unknown>, invalidate: string[][]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k })),
  });
}

export const useCreateCluster = () =>
  useAdminMutation(
    (b: ClusterInput) => api('/console/clusters/new', { method: 'POST', body: b }),
    [['adminClusters']],
  );
export const usePatchCluster = () =>
  useAdminMutation(
    ({ id, patch }: { id: string; patch: Partial<ClusterInput> }) =>
      api(`/console/clusters/${id}`, { method: 'PATCH', body: patch }),
    [['adminClusters']],
  );
export const useCreateShop = () =>
  useAdminMutation(
    (b: ShopInput) => api('/console/shops/new', { method: 'POST', body: b }),
    [['adminShops'], ['adminClusters']],
  );
export const usePatchShop = () =>
  useAdminMutation(
    ({ id, patch }: { id: string; patch: ShopPatch }) =>
      api(`/console/shops/${id}`, { method: 'PATCH', body: patch }),
    [['adminShops'], ['shops'], ['metrics']],
  );
export const useCreateCategory = () =>
  useAdminMutation(
    (b: CategoryInput) => api('/console/categories/new', { method: 'POST', body: b }),
    [['adminCategories']],
  );
export const usePatchCategory = () =>
  useAdminMutation(
    ({ id, patch }: { id: string; patch: Partial<CategoryInput> }) =>
      api(`/console/categories/${id}`, { method: 'PATCH', body: patch }),
    [['adminCategories'], ['adminShops']],
  );
export const useDecideLicence = () =>
  useAdminMutation(
    ({ id, decision, notes }: { id: string; decision: 'verify' | 'reject'; notes?: string }) =>
      api(`/console/licences/${id}/${decision}`, { method: 'POST', body: notes ? { notes } : {} }),
    [['adminLicences'], ['adminShops'], ['shops'], ['metrics']],
  );
export const useUnblock = () =>
  useAdminMutation(
    (id: string) => api(`/console/users/${id}/unblock`, { method: 'POST' }),
    [['blocked']],
  );
