// The plan list lives ONLY on this phone (localStorage) and in the ticket QR.
// It is never sent to the server (G1, G2).
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { MAX_LINE_QTY, MAX_PLAN_LINES, normalizeLines, type PlanLine } from '@pataka/shared';

export type StoredPlan = { priceVersion: number; lines: PlanLine[]; updatedAt: string };

const key = (shopCode: string) => `pp.plan.${shopCode.toUpperCase()}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; plan: StoredPlan | null }>();

function read(shopCode: string): StoredPlan | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(shopCode));
  } catch {
    // storage unavailable
  }
  const hit = cache.get(shopCode);
  if (hit && hit.raw === raw) return hit.plan;
  let plan: StoredPlan | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as StoredPlan) : null;
    if (parsed && Array.isArray(parsed.lines)) plan = parsed;
  } catch {
    plan = null;
  }
  cache.set(shopCode, { raw, plan });
  return plan;
}

function write(shopCode: string, plan: StoredPlan | null) {
  try {
    if (!plan || plan.lines.length === 0) localStorage.removeItem(key(shopCode));
    else localStorage.setItem(key(shopCode), JSON.stringify(plan));
  } catch {
    // storage unavailable: the list just won't survive a reload
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key?.startsWith('pp.plan.') && cb();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function getPlan(shopCode: string): StoredPlan | null {
  return read(shopCode);
}

export function usePlan(shopCode: string, priceVersion: number | undefined) {
  const plan = useSyncExternalStore(
    subscribe,
    () => read(shopCode),
    () => null,
  );
  const lines = useMemo(() => plan?.lines ?? [], [plan]);

  const setQty = useCallback(
    (itemNo: number, qty: number) => {
      const current = read(shopCode)?.lines ?? [];
      const others = current.filter((l) => l.itemNo !== itemNo);
      const next = qty > 0 ? [...others, { itemNo, qty: Math.min(qty, MAX_LINE_QTY) }] : others;
      if (next.length > MAX_PLAN_LINES) return false;
      write(shopCode, {
        priceVersion: priceVersion ?? read(shopCode)?.priceVersion ?? 1,
        lines: normalizeLines(next),
        updatedAt: new Date().toISOString(),
      });
      return true;
    },
    [shopCode, priceVersion],
  );

  const clear = useCallback(() => write(shopCode, null), [shopCode]);
  const qtyOf = useCallback(
    (itemNo: number) => lines.find((l) => l.itemNo === itemNo)?.qty ?? 0,
    [lines],
  );
  const count = lines.reduce((n, l) => n + l.qty, 0);
  return { plan, lines, setQty, clear, qtyOf, count };
}
