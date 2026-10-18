import { useMemo } from 'react';
import type { Item, ItemsResponse, PlanLine } from '@pataka/shared';

export type PlanRow = PlanLine & { item: Item | null; lineTotal: number };

/** Joins plan lines to today's price list. Prices are always today's (final at the counter). */
export function usePlanDetails(lines: PlanLine[], data: ItemsResponse | undefined) {
  return useMemo(() => {
    const byNo = new Map(data?.items.map((i) => [i.itemNo, i]));
    const rows: PlanRow[] = lines.map((l) => {
      const item = byNo.get(l.itemNo) ?? null;
      return { ...l, item, lineTotal: item && !item.isSoldOut ? item.pricePaise * l.qty : 0 };
    });
    const total = rows.reduce((n, r) => n + r.lineTotal, 0);
    const unavailable = rows.filter((r) => !r.item || r.item.isSoldOut).length;
    return { rows, total, unavailable };
  }, [lines, data]);
}
