import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decodePlan, formatPaise, type Item, type PlanPayload } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { QrScanner } from '../../components/QrScanner';
import { Badge, Button, Card, Notice, cx } from '../../components/ui';
import { itemName } from '../../lib/format';
import { useOwnItems, useServe, useShopContext } from '../../lib/queries';

type Line = {
  itemNo: number;
  qty: number;
  item: Item | null;
  soldOut: boolean;
  priceChanged: boolean;
  lineTotal: number;
};

/**
 * Counter: scan the customer's list QR → pick list (by rack) → bill → print →
 * mark served. The list is decoded and priced HERE, on this device; only the
 * visit code is ever sent to the server (G1, G2).
 */
export function Counter() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const items = useOwnItems();
  const serve = useServe();
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [served, setServed] = useState(false);

  const lines: Line[] = useMemo(() => {
    if (!plan) return [];
    const byNo = new Map(items.data?.items.map((i) => [i.itemNo, i]));
    return plan.lines.map((l) => {
      const item = byNo.get(l.itemNo) ?? null;
      const soldOut = !item || item.isSoldOut || !item.isActive;
      return {
        ...l,
        item,
        soldOut,
        priceChanged: !!item && item.priceVersion > plan.priceVersion,
        lineTotal: item && !soldOut ? item.pricePaise * l.qty : 0,
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

  const onScan = (text: string) => {
    setScanError(null);
    setServed(false);
    setPicked(new Set());
    serve.reset();
    const r = decodePlan(text);
    if (!r.ok) {
      // A bare visit code (typed by hand) is allowed, with an empty list.
      if (/^[0-9A-Z]{6}$/i.test(text.trim()) && ctx.data) {
        setPlan({
          visitCode: text.trim().toUpperCase(),
          shopCode: ctx.data.shopCode,
          priceVersion: ctx.data.priceVersion,
          lines: [],
        });
        return;
      }
      setPlan(null);
      setScanError(t(`counter.decode.${r.error}`, { defaultValue: t('counter.badQr') }));
      return;
    }
    if (ctx.data && r.value.shopCode !== ctx.data.shopCode) {
      setPlan(null);
      setScanError(t('counter.otherShop', { code: r.value.shopCode }));
      return;
    }
    setPlan(r.value);
  };

  const reset = () => {
    setPlan(null);
    setServed(false);
    setPicked(new Set());
    serve.reset();
  };

  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="p-6">
          <h2 className="text-2xl font-semibold">{t('counter.title')}</h2>
          <p className="mt-1 mb-5 text-muted">{t('counter.subtitle')}</p>
          <QrScanner
            onResult={onScan}
            manualLabel={t('counter.manual')}
            manualPlaceholder={t('counter.manualPlaceholder')}
          />
        </Card>
        {scanError && <Notice tone="danger">{scanError}</Notice>}
        <p className="text-center text-xs text-muted">{t('counter.privacy')}</p>
      </div>
    );
  }

  const stale = ctx.data && plan.priceVersion !== ctx.data.priceVersion;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="no-print">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">{t('counter.pickList')}</h2>
          <Badge tone="plum">
            {plan.visitCode ? `${t('counter.ticket')} ${plan.visitCode}` : t('counter.walkIn')}
          </Badge>
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
              {plan.visitCode ? `${t('counter.ticket')} ${plan.visitCode}` : t('counter.walkIn')} ·{' '}
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
                    {l.item ? formatPaise(l.item.pricePaise) : '—'}
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
          {plan.visitCode ? (
            <Button
              variant="success"
              size="lg"
              disabled={serve.isPending || served}
              onClick={() => serve.mutate(plan.visitCode!, { onSuccess: () => setServed(true) })}
            >
              ✓ {served ? t('counter.servedDone') : t('shopApp.markServed')}
            </Button>
          ) : (
            <Button variant="dark" size="lg" onClick={reset}>
              {t('counter.done')}
            </Button>
          )}
        </div>
        <ErrorText error={serve.error} />
        {served && (
          <Notice tone="emerald" className="no-print mt-3">
            {t('counter.servedNote')}
          </Notice>
        )}
        <Button variant="ghost" className="no-print mt-3 w-full" onClick={reset}>
          ⌖ {t('counter.next')}
        </Button>
      </section>
    </div>
  );
}
