import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPaise, type Item, type PlanPayload } from '@pataka/shared';
import { Badge, Button, Card, Notice, cx } from '../../components/ui';
import { itemName } from '../../lib/format';
import { useOwnItems, useShopContext } from '../../lib/queries';

type Line = {
  itemNo: number;
  qty: number;
  item: Item | null;
  soldOut: boolean;
  priceChanged: boolean;
  lineTotal: number;
};

/**
 * Walk-in list (PP1 QR) at the counter: pick list by rack → bill → print. The
 * list is decoded and priced HERE, on this device; nothing is sent to the
 * server. Prices are today's (offer) prices.
 */
export function WalkInBill({ plan, onDone }: { plan: PlanPayload; onDone: () => void }) {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const items = useOwnItems();
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const lines: Line[] = useMemo(() => {
    const byNo = new Map(items.data?.items.map((i) => [i.itemNo, i]));
    return plan.lines.map((l) => {
      const item = byNo.get(l.itemNo) ?? null;
      const soldOut = !item || item.isSoldOut || !item.isActive;
      return {
        ...l,
        item,
        soldOut,
        priceChanged: !!item && item.priceVersion > plan.priceVersion,
        lineTotal: item && !soldOut ? item.effectivePricePaise * l.qty : 0,
      };
    });
  }, [plan, items.data]);
  const total = lines.reduce((n, l) => n + l.lineTotal, 0);
  const byRack = useMemo(() => {
    const groups = new Map<string, Line[]>();
    for (const l of lines) {
      const rack = l.item?.rackCode || t('counter.noRack');
      groups.set(rack, [...(groups.get(rack) ?? []), l]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lines, t]);

  const stale = ctx.data && plan.priceVersion !== ctx.data.priceVersion;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="no-print">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">{t('counter.pickList')}</h2>
          <Badge tone="plum">{t('counter.walkIn')}</Badge>
        </div>
        {lines.length === 0 && <Notice>{t('counter.emptyList')}</Notice>}
        <div className="space-y-4">
          {byRack.map(([rack, rows]) => (
            <Card key={rack} className="overflow-hidden">
              <p className="bg-plum px-5 py-2.5 font-display text-lg font-semibold text-white">
                {t('counter.rack', { rack })}
              </p>
              <ul className="divide-y divide-line/70">
                {rows.map((l) => {
                  const done = picked.has(l.itemNo);
                  return (
                    <li key={l.itemNo}>
                      <label
                        className={cx(
                          'flex min-h-16 cursor-pointer items-center gap-4 px-5 py-3',
                          l.soldOut && 'bg-danger-soft/60',
                          done && 'opacity-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-7 w-7 shrink-0 accent-emerald"
                          checked={done}
                          disabled={l.soldOut}
                          onChange={() =>
                            setPicked((p) => {
                              const n = new Set(p);
                              if (n.has(l.itemNo)) n.delete(l.itemNo);
                              else n.add(l.itemNo);
                              return n;
                            })
                          }
                        />
                        <span className="font-display text-3xl font-semibold text-plum">
                          {l.qty}×
                        </span>
                        <span
                          className={cx('flex-1 text-lg font-semibold', done && 'line-through')}
                        >
                          {l.item ? itemName(l.item) : t('plan.unknownItem', { no: l.itemNo })}
                          <span className="block text-sm font-normal text-muted">
                            #{l.itemNo} {l.item?.packDesc && `· ${l.item.packDesc}`}
                          </span>
                        </span>
                        {l.soldOut && <Badge tone="danger">{t('shopPage.soldOut')}</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <Card className="print-area p-6">
          <div className="text-center">
            <p className="font-display text-xl font-semibold">{ctx.data?.name}</p>
            <p className="text-xs text-muted">
              {t('counter.walkIn')} ·{' '}
              {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </p>
          </div>
          {stale && <Notice className="no-print mt-4">{t('counter.stale')}</Notice>}
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted uppercase">
                <th className="py-2">{t('counter.item')}</th>
                <th className="py-2 text-right">{t('counter.qty')}</th>
                <th className="py-2 text-right">{t('counter.rate')}</th>
                <th className="py-2 text-right">{t('counter.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={l.itemNo}
                  className={cx(
                    'border-b border-line/60',
                    l.soldOut && 'bg-danger-soft/60 text-danger',
                    l.priceChanged && !l.soldOut && 'bg-gold-light/40',
                  )}
                >
                  <td className="py-2 pr-2">
                    {l.item ? itemName(l.item) : `#${l.itemNo}`}
                    {l.soldOut && (
                      <span className="block text-xs font-semibold">
                        {t('counter.notAvailable')}
                      </span>
                    )}
                    {l.priceChanged && !l.soldOut && (
                      <span className="block text-xs font-semibold text-gold-deep">
                        {t('counter.priceChanged')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">
                    {l.item ? formatPaise(l.item.effectivePricePaise) : '—'}
                  </td>
                  <td className="py-2 text-right font-semibold">
                    {l.soldOut ? '—' : formatPaise(l.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-4 font-display text-lg font-semibold">
                  {t('counter.total')}
                </td>
                <td className="pt-4 text-right font-display text-2xl font-semibold">
                  {formatPaise(total)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-5 border-t border-dashed border-line pt-3 text-center text-xs font-semibold">
            {t('counter.payHere')}
          </p>
          <p className="mt-1 text-center text-[10px] text-muted">{t('safety.notice')}</p>
        </Card>

        <div className="no-print mt-4 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" onClick={() => window.print()}>
            🖨 {t('counter.print')}
          </Button>
          <Button variant="dark" size="lg" onClick={onDone}>
            {t('counter.done')}
          </Button>
        </div>
      </section>
    </div>
  );
}
