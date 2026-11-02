// Items sold by weight that the customer is adding, kept on this phone until
// the order is placed (next to the pack list in planList.ts). The server prices
// them from the catalogue when the order is placed (G11).
import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type WeightLine = { itemId: string; itemNo: number; grams: number; mixItemIds?: string[] };

const key = (shopCode: string) => `pp.weigh.${shopCode.toUpperCase()}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; lines: WeightLine[] }>();
const EMPTY: WeightLine[] = [];

function read(shopCode: string): WeightLine[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(shopCode));
  } catch {
    // storage unavailable
  }
  const hit = cache.get(shopCode);
  if (hit && hit.raw === raw) return hit.lines;
  let lines: WeightLine[] = EMPTY;
  try {
    const parsed = raw ? (JSON.parse(raw) as WeightLine[]) : null;
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = EMPTY;
  }
  cache.set(shopCode, { raw, lines });
  return lines;
}

function write(shopCode: string, lines: WeightLine[]) {
  try {
    if (!lines.length) localStorage.removeItem(key(shopCode));
    else localStorage.setItem(key(shopCode), JSON.stringify(lines));
  } catch {
    // storage unavailable
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useWeights(shopCode: string) {
  const lines = useSyncExternalStore(
    subscribe,
    () => read(shopCode),
    () => EMPTY,
  );
  const set = useCallback(
    (line: WeightLine) => {
      const others = read(shopCode).filter((l) => l.itemId !== line.itemId);
      write(shopCode, line.grams > 0 ? [...others, line] : others);
    },
    [shopCode],
  );
  const clear = useCallback(() => write(shopCode, []), [shopCode]);
  const byItem = useMemo(() => new Map(lines.map((l) => [l.itemId, l])), [lines]);
  return { lines, set, clear, get: (itemId: string) => byItem.get(itemId) };
}
