import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  FINAL_ORDER_STATUSES,
  adminClusterSchema,
  adminOrderSchema,
  adminShopSchema,
  areaSchema,
  blockedUserSchema,
  categorySchema,
  customerOrderSchema,
  customerOrderSummarySchema,
  demoInfoSchema,
  footfallRowSchema,
  gateLookupSchema,
  itemSchema,
  itemsResponseSchema,
  licenceSchema,
  meSchema,
  merchantPaymentSettingsViewSchema,
  metricsSchema,
  mockCheckoutSchema,
  orderQrResponseSchema,
  packStickerSchema,
  shopContextSchema,
  shopDetailSchema,
  shopSummarySchema,
  staffOrderSchema,
  staffOrderSummarySchema,
  type CategoryInput,
  type ClusterInput,
  type CustomerDecision,
  type CustomerOrder,
  type ImageUpload,
  type ItemInput,
  type ItemPatch,
  type LicenceSubmit,
  type MerchantPaymentSettingsInput,
  type OrderStatus,
  type PlaceOrder,
  type ProposeAlternate,
  type ShopInput,
  type ShopPatch,
  type ShopSettings,
  type Weigh,
} from '@pataka/shared';
import { switchAccount, useMe } from '../auth/useAuth';
import { api } from './api';
import { savePickupQr } from './orderStore';

const isFinal = (s: OrderStatus | undefined) =>
  !!s && (FINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(s);

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

const orderingInfoSchema = z.object({
  enabled: z.boolean(),
  feePaise: z.number(),
  confirmWindowHours: z.number(),
});

export const useOrderingInfo = () =>
  useQuery({
    queryKey: ['ordering'],
    queryFn: () => api('/ordering', { schema: orderingInfoSchema }),
    staleTime: 5 * 60_000,
  });

// ---- Customer orders ----

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlaceOrder) =>
      api('/orders', { method: 'POST', body, schema: customerOrderSchema }),
    onSuccess: (order) => {
      qc.setQueryData(['order', order.id], order);
      void qc.invalidateQueries({ queryKey: ['myOrders'] });
    },
  });
}

export const useMyOrders = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['myOrders'],
    queryFn: () => api('/orders/mine', { schema: z.array(customerOrderSummarySchema) }),
  });

export const useOrder = (id: string) =>
  useQuery({
    queryKey: ['order', id],
    queryFn: () => api(`/orders/${id}`, { schema: customerOrderSchema }),
    // The shop works on it meanwhile: keep the status fresh until it closes.
    refetchInterval: (q) => (isFinal(q.state.data?.status) ? false : 10_000),
  });

function useOrderMutation<TBody>(
  fn: (id: string, body: TBody) => Promise<CustomerOrder>,
  id: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => fn(id, body),
    onSuccess: (order) => {
      qc.setQueryData(['order', id], order);
      void qc.invalidateQueries({ queryKey: ['myOrders'] });
    },
  });
}

export const useStartFee = (id: string) =>
  useOrderMutation(
    (oid) => api(`/orders/${oid}/fee`, { method: 'POST', schema: customerOrderSchema }),
    id,
  );

export const useCancelOrder = (id: string) =>
  useOrderMutation(
    (oid, reason: string | undefined) =>
      api(`/orders/${oid}/cancel`, {
        method: 'POST',
        body: reason ? { reason } : {},
        schema: customerOrderSchema,
      }),
    id,
  );

export const useDecision = (id: string) =>
  useOrderMutation(
    (oid, body: CustomerDecision) =>
      api(`/orders/${oid}/decisions`, { method: 'POST', body, schema: customerOrderSchema }),
    id,
  );

/** Shows (and rotates) the pickup QR, keeping a copy on the phone for the ground. */
export const usePickupQr = (id: string) =>
  useMutation({
    mutationFn: () =>
      api(`/orders/${id}/pickup-qr`, { method: 'POST', schema: orderQrResponseSchema }),
    onSuccess: (r) => savePickupQr(r.orderId, r.qr),
  });

export const useMockCheckout = (checkoutId: string) =>
  useQuery({
    queryKey: ['mockCheckout', checkoutId],
    queryFn: () => api(`/payments/mock/${checkoutId}`, { schema: mockCheckoutSchema }),
  });

export function useMockComplete(checkoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outcome: 'success' | 'fail') =>
      api(`/payments/mock/${checkoutId}/complete`, {
        method: 'POST',
        body: { outcome },
        schema: z.object({ ok: z.boolean(), outcome: z.string(), orderId: z.string() }),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['order', r.orderId] });
      void qc.invalidateQueries({ queryKey: ['mockCheckout', checkoutId] });
      void qc.invalidateQueries({ queryKey: ['myOrders'] });
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
  onDone?: (out: TOut) => void,
) {
  const qc = useQueryClient();
  const s = useShopScope();
  return useMutation({
    mutationFn: (body: TBody) => fn(s.q(), body),
    onSuccess: (out) => {
      invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      onDone?.(out);
    },
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

export const useItemImage = () =>
  useShopMutation(
    (q, { id, image }: { id: string; image: ImageUpload }) =>
      api(`/shop/items/${id}/image${q}`, { method: 'POST', body: image, schema: itemSchema }),
    [['ownItems']],
  );

export const useSaveSettings = () =>
  useShopMutation(
    (q, body: ShopSettings) =>
      api(`/shop/settings${q}`, { method: 'PUT', body, schema: shopContextSchema }),
    [['shopCtx']],
  );

export type OrdersView = 'incoming' | 'packing' | 'counter' | 'done';

export function useShopOrders(view: OrdersView) {
  const s = useShopScope();
  return useQuery({
    queryKey: ['shopOrders', s.code, view],
    queryFn: () =>
      api(`/shop/orders?view=${view}${s.q('&')}`, { schema: z.array(staffOrderSummarySchema) }),
    refetchInterval: 10_000, // SPEC §3: shop screens poll every 10 s
  });
}

export function useShopOrder(id: string | null) {
  const s = useShopScope();
  return useQuery({
    enabled: !!id,
    queryKey: ['shopOrder', s.code, id],
    queryFn: () => api(`/shop/orders/${id}${s.q()}`, { schema: staffOrderSchema }),
    refetchInterval: 10_000,
  });
}

/** POST to a shop-order action; refreshes the lists and the open order. */
function useOrderAction<TBody>(action: string) {
  const qc = useQueryClient();
  const s = useShopScope();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: TBody }) =>
      api(`/shop/orders/${id}/${action}${s.q()}`, {
        method: 'POST',
        body,
        schema: staffOrderSchema,
      }),
    onSuccess: (o) => {
      qc.setQueryData(['shopOrder', s.code, o.id], o);
      void qc.invalidateQueries({ queryKey: ['shopOrders'] });
    },
  });
}

export const useConfirmOrder = () => useOrderAction<undefined>('confirm');
export const useRejectOrder = () => useOrderAction<{ reason: string }>('reject');
export const useStartPacking = () => useOrderAction<undefined>('start-packing');
export const useScanItem = () => useOrderAction<{ barcode: string }>('scan');
export const usePickByHand = () => useOrderAction<{ lineId: string }>('pick');
export const useOutOfStock = () => useOrderAction<{ lineId: string }>('out-of-stock');
export const useProposeAlternate = () => useOrderAction<ProposeAlternate>('alternate');
export const useWeighLine = () => useOrderAction<Weigh>('weigh');

export function useFinishPacking() {
  const qc = useQueryClient();
  const s = useShopScope();
  return useMutation({
    mutationFn: ({ id, reprint }: { id: string; reprint?: boolean }) =>
      api(`/shop/orders/${id}/${reprint ? 'sticker' : 'finish'}${s.q()}`, {
        method: 'POST',
        schema: packStickerSchema,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['shopOrders'] });
      void qc.invalidateQueries({ queryKey: ['shopOrder'] });
    },
  });
}

/** Express Pickup counter calls. */
function useCounterCall<TBody>(path: (id: string) => string) {
  const qc = useQueryClient();
  const s = useShopScope();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: TBody }) =>
      api(`/shop/counter/${path(id)}${s.q()}`, { method: 'POST', body, schema: staffOrderSchema }),
    onSuccess: (o) => {
      qc.setQueryData(['counterOrder', s.code, o.id], o);
      void qc.invalidateQueries({ queryKey: ['shopOrders'] });
    },
  });
}

export const useCounterOpen = () => useCounterCall<{ qr: string }>(() => 'open');
export const useCounterPack = () => useCounterCall<{ qr: string }>((id) => `${id}/pack`);
export const useCounterUpi = () => useCounterCall<undefined>((id) => `${id}/upi`);
export const useCounterUpiSim = () => useCounterCall<undefined>((id) => `${id}/upi-simulated`);
export const useCounterCard = () => useCounterCall<{ approvalCode: string }>((id) => `${id}/card`);
export const useCounterCash = () => useCounterCall<{ receivedPaise: number }>((id) => `${id}/cash`);

/** Polls a pending UPI payment; the server asks the merchant's YouPI-PG. */
export function useCounterPoll(id: string | null, enabled: boolean) {
  const s = useShopScope();
  return useQuery({
    enabled: !!id && enabled,
    queryKey: ['counterOrder', s.code, id],
    queryFn: () => api(`/shop/counter/${id}${s.q()}`, { schema: staffOrderSchema }),
    refetchInterval: enabled ? 3_000 : false,
  });
}

export function usePaymentSettings(shopId?: string) {
  const s = useShopScope();
  const path = shopId
    ? `/console/shops/${shopId}/payment-settings`
    : `/shop/payment-settings${s.q()}`;
  return useQuery({
    queryKey: ['paymentSettings', shopId ?? s.code],
    queryFn: () => api(path, { schema: merchantPaymentSettingsViewSchema }),
  });
}

export function useSavePaymentSettings(shopId?: string) {
  const qc = useQueryClient();
  const s = useShopScope();
  const path = shopId
    ? `/console/shops/${shopId}/payment-settings`
    : `/shop/payment-settings${s.q()}`;
  return useMutation({
    mutationFn: (body: MerchantPaymentSettingsInput) =>
      api(path, { method: 'PUT', body, schema: merchantPaymentSettingsViewSchema }),
    onSuccess: (v) => qc.setQueryData(['paymentSettings', shopId ?? s.code], v),
  });
}

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

export function useGateLookup() {
  const c = useClusterScope();
  return useMutation({
    mutationFn: (qr: string) =>
      api(`/gate/lookup${c.q()}`, { method: 'POST', body: { qr }, schema: gateLookupSchema }),
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

export const useAdminOrders = (q: string, status: string) =>
  useQuery({
    queryKey: ['adminOrders', q, status],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (status) qs.set('status', status);
      return api(`/console/orders?${qs}`, { schema: z.array(adminOrderSchema) });
    },
  });

export const useBlocked = () =>
  useQuery({
    queryKey: ['blocked'],
    queryFn: () => api('/console/users/blocked', { schema: z.array(blockedUserSchema) }),
  });

export const useMetrics = () =>
  useQuery({
    queryKey: ['metrics'],
    queryFn: () => api('/console/metrics', { schema: metricsSchema }),
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
export const useRefundFee = () =>
  useAdminMutation(
    ({ id, reason }: { id: string; reason: string }) =>
      api(`/console/orders/${id}/refund-fee`, { method: 'POST', body: { reason } }),
    [['adminOrders'], ['metrics']],
  );
