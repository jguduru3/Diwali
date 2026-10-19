import { useMemo } from 'react';
import { lineAmount, type Item, type ItemsResponse, type PlanLine } from '@pataka/shared';
import type { WeightLine } from '../../lib/weightList';

export type PlanRow = PlanLine & { item: Item | null; lineTotal: number };
export type WeightRow = WeightLine & { item: Item | null; mix: Item[]; lineTotal: number };

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

/** Same for items sold by weight (₹/kg × grams). */
export function useWeightDetails(lines: WeightLine[], data: ItemsResponse | undefined) {
  return useMemo(() => {
    const byId = new Map(data?.items.map((i) => [i.id, i]));
    const rows: WeightRow[] = lines.map((l) => {
      const item = byId.get(l.itemId) ?? null;
      return {
        ...l,
        item,
        mix: (l.mixItemIds ?? []).map((id) => byId.get(id)).filter((x): x is Item => !!x),
        lineTotal:
          item && !item.isSoldOut ? lineAmount(item.effectivePricePaise, { grams: l.grams }) : 0,
      };
    });
    const total = rows.reduce((n, r) => n + r.lineTotal, 0);
    const unavailable = rows.filter(
      (r) => !r.item || r.item.isSoldOut || (r.item.saleUnit === 'mix_kg' && !r.mix.length),
    ).length;
    return { rows, total, unavailable };
  }, [lines, data]);
}
