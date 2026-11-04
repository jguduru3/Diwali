import { useMemo } from 'react';
import type { Item, ItemsResponse, PlanLine } from '@pataka/shared';

export type PlanRow = PlanLine & { item: Item | null; lineTotal: number };

/** Joins the order lines to today's product list, at today's (offer) prices. */
export function usePlanDetails(lines: PlanLine[], data: ItemsResponse | undefined) {
  return useMemo(() => {
    const byNo = new Map(data?.items.map((i) => [i.itemNo, i]));
    const rows: PlanRow[] = lines.map((l) => {
      const item = byNo.get(l.itemNo) ?? null;
      return {
        ...l,
        item,
        lineTotal: item && !item.isSoldOut ? item.effectivePricePaise * l.qty : 0,
      };
    });
    const total = rows.reduce((n, r) => n + r.lineTotal, 0);
    const unavailable = rows.filter((r) => !r.item || r.item.isSoldOut).length;
    return { rows, total, unavailable };
  }, [lines, data]);
}
