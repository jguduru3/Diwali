import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { addDays, formatOrderCode, formatPaise, istDate, staffPhoneMask } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageTitle,
  Select,
  Spinner,
  Stat,
  cx,
} from '../../components/ui';
import { dateTimeIST, dayIST, itemName } from '../../lib/format';
import { useShopAnalytics, useShopScope } from '../../lib/queries';
import {
  Banknote,
  Check,
  CreditCard,
  FileSpreadsheet,
  Package,
  QrCode,
  Tag,
  Wallet,
} from 'lucide-react';
import { Icon } from '../../components/Icon';

type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom';
type AnalyticsTab = 'products' | 'inventory';

export function Report() {
  const { t } = useTranslation();
  const shopScope = useShopScope();

  const today = istDate();
  const [preset, setPreset] = useState<DatePreset>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [method, setMethod] = useState<string>('');
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>('products');

  const handlePreset = (p: DatePreset) => {
    setPreset(p);
    if (p === 'today') {
      setFrom(today);
      setTo(today);
    } else if (p === 'yesterday') {
      const y = addDays(today, -1);
      setFrom(y);
      setTo(y);
    } else if (p === 'last7') {
      setFrom(addDays(today, -6));
      setTo(today);
    } else if (p === 'last30') {
      setFrom(addDays(today, -29));
      setTo(today);
    } else if (p === 'thisMonth') {
      setFrom(today.slice(0, 8) + '01');
      setTo(today);
    }
  };

  const analytics = useShopAnalytics({
    from,
    to,
    method: method || undefined,
  });

  const handleExport = () => {
    const p = new URLSearchParams({ from, to });
    if (method) p.set('method', method);
    const downloadUrl = `/api/shop/analytics/export?${p.toString()}${shopScope.q('&')}`;
    window.open(downloadUrl, '_blank');
  };

  if (analytics.isPending) return <Spinner label={t('common.loading')} />;
  if (analytics.error) return <ErrorText error={analytics.error} />;

  const data = analytics.data;
  const kpis = data.kpis;
  const breakdown = data.paymentBreakdown;
  const totalTransactionCount = breakdown.qr.count + breakdown.cash.count + breakdown.card.count;
  const maxTrend = Math.max(1, ...(data.salesTrend?.map((r) => r.orders) ?? [1]));

  return (
    <div className="space-y-8">
      {/* Page Title & Export Action */}
      <PageTitle
        title={t('report.analyticsTitle')}
        subtitle={t('report.analyticsSubtitle')}
        action={
          <Button variant="secondary" onClick={handleExport}>
            <Icon icon={FileSpreadsheet} /> {t('report.exportExcel')}
          </Button>
        }
      />

      {/* Filter Bar: Presets & Controls */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-sand/60 p-1">
            {(
              [
                ['today', t('report.today')],
                ['yesterday', t('report.yesterday')],
                ['last7', t('report.last7Days')],
                ['last30', t('report.last30Days')],
                ['thisMonth', t('report.thisMonth')],
                ['custom', t('report.customRange')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={cx(
                  'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                  preset === key ? 'bg-white text-plum shadow-xs' : 'text-muted hover:text-ink',
                )}
                onClick={() => handlePreset(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Payment Method Filter */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-muted uppercase">
              {t('report.filterMethod')}:
            </span>
            <Select
              className="min-h-10 text-xs py-1.5"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">{t('report.allMethods')}</option>
              <option value="upi">{t('report.methodUpi')}</option>
              <option value="cash">{t('report.methodCash')}</option>
              <option value="card">{t('report.methodCard')}</option>
            </Select>
          </div>
        </div>

        {/* Custom Date Pickers */}
        {preset === 'custom' && (
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line/60 pt-4">
            <Field label={t('report.startDate')} className="text-xs">
              <Input
                type="date"
                value={from}
                max={to}
                className="min-h-10 text-xs py-1"
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t('report.endDate')} className="text-xs">
              <Input
                type="date"
                value={to}
                min={from}
                max={today}
                className="min-h-10 text-xs py-1"
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Card>

      {/* Section A: Sales Overview KPI Cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-wider text-muted uppercase">
          {t('report.kpis')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label={t('report.totalSales')}
            value={formatPaise(kpis.totalSalesPaise)}
            tone="gold"
          />
          <Stat label={t('report.completedOrders')} value={kpis.completedOrders} tone="emerald" />
          <Stat label={t('report.itemsSold')} value={kpis.totalItemsSold} tone="plum" />
          <Stat
            label={t('report.aov')}
            value={formatPaise(kpis.averageOrderValuePaise)}
            tone="saffron"
          />
          <Stat label={t('report.cancelledOrders')} value={kpis.cancelledOrders} tone="rose" />
          <Stat
            label={t('report.refundAmount')}
            value={formatPaise(kpis.refundAmountPaise)}
            tone="rose"
          />
        </div>
      </section>

      {/* Section B: Payment Mode Breakdown */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold tracking-wider text-muted uppercase">
          {t('report.paymentBreakdown')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4 border-l-4 border-l-gold">
            <p className="text-xs font-semibold text-muted uppercase">
              <Icon icon={QrCode} /> {t('report.phonepeTotal')}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">
              {formatPaise(breakdown.qr.totalPaise)}
            </p>
            <p className="mt-1 text-xs text-muted">{breakdown.qr.count} orders settled</p>
          </Card>

          <Card className="p-4 border-l-4 border-l-emerald">
            <p className="text-xs font-semibold text-muted uppercase">
              <Icon icon={Banknote} /> {t('report.cashTotal')}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">
              {formatPaise(breakdown.cash.totalPaise)}
            </p>
            <p className="mt-1 text-xs text-muted">{breakdown.cash.count} orders settled</p>
          </Card>

          <Card className="p-4 border-l-4 border-l-plum">
            <p className="text-xs font-semibold text-muted uppercase">
              <Icon icon={CreditCard} /> {t('report.cardTotal')}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">
              {formatPaise(breakdown.card.totalPaise)}
            </p>
            <p className="mt-1 text-xs text-muted">{breakdown.card.count} orders settled</p>
          </Card>

          <Card className="p-4 bg-sand/30 border-l-4 border-l-saffron">
            <p className="text-xs font-semibold text-muted uppercase">
              <Icon icon={Wallet} /> {t('report.totalCollections')}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-gold-deep">
              {formatPaise(breakdown.totalCollectionsPaise)}
            </p>
            <p className="mt-1 text-xs text-muted">{totalTransactionCount} total transactions</p>
          </Card>
        </div>
      </section>

      {/* Section C: Daily Sales Trend */}
      {data.salesTrend && data.salesTrend.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold">{t('report.perDay')}</h3>
            <p className="text-xs text-muted">{t('report.note')}</p>
          </div>
          <ul className="space-y-3">
            {data.salesTrend.map((r) => (
              <li
                key={r.day}
                className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm"
              >
                <span className="font-semibold">{dayIST(r.day)}</span>
                <span className="relative h-7 overflow-hidden rounded-lg bg-sand" aria-hidden>
                  <span
                    className="absolute inset-y-0 left-0 rounded-lg bg-gold-light"
                    style={{ width: `${(r.orders / maxTrend) * 100}%` }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-lg bg-emerald/70"
                    style={{ width: `${(r.completed / maxTrend) * 100}%` }}
                  />
                </span>
                <span className="text-right text-muted">
                  {t('report.row', {
                    orders: r.orders,
                    completed: r.completed,
                    sales: formatPaise(r.salesPaise),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Section D & E: Product Sales & Inventory Analytics */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
          <div className="flex gap-4">
            <button
              type="button"
              className={cx(
                'text-base font-semibold pb-2 border-b-2 transition',
                analyticsTab === 'products'
                  ? 'border-gold text-ink'
                  : 'border-transparent text-muted hover:text-ink',
              )}
              onClick={() => setAnalyticsTab('products')}
            >
              <Icon icon={Package} /> {t('report.productAnalytics')}
            </button>
            <button
              type="button"
              className={cx(
                'text-base font-semibold pb-2 border-b-2 transition',
                analyticsTab === 'inventory'
                  ? 'border-gold text-ink'
                  : 'border-transparent text-muted hover:text-ink',
              )}
              onClick={() => setAnalyticsTab('inventory')}
            >
              <Icon icon={Tag} /> {t('report.inventoryAnalytics')}
            </button>
          </div>
        </div>

        {analyticsTab === 'products' && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3">{t('report.productName')}</th>
                    <th className="px-4 py-3">{t('report.category')}</th>
                    <th className="px-4 py-3 text-right">{t('report.qtySold')}</th>
                    <th className="px-5 py-3 text-right">{t('report.salesAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {data.productSales && data.productSales.length > 0 ? (
                    data.productSales.map((p) => (
                      <tr key={p.itemId} className="hover:bg-sand/20">
                        <td className="px-5 py-3 font-medium text-ink">{itemName(p)}</td>
                        <td className="px-4 py-3 text-muted">{p.categoryName}</td>
                        <td className="px-4 py-3 text-right font-semibold">{p.qtySold}</td>
                        <td className="px-5 py-3 text-right font-bold text-ink">
                          {formatPaise(p.salesPaise)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted text-sm">
                        {t('report.noRecords')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {analyticsTab === 'inventory' && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3">{t('report.productName')}</th>
                    <th className="px-4 py-3">{t('report.category')}</th>
                    <th className="px-4 py-3 text-right">{t('prices.price')}</th>
                    <th className="px-4 py-3 text-right">{t('report.remainingStock')}</th>
                    <th className="px-5 py-3 text-center">{t('report.stockStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {data.inventory && data.inventory.length > 0 ? (
                    data.inventory.map((inv) => (
                      <tr key={inv.itemId} className="hover:bg-sand/20">
                        <td className="px-5 py-3 font-medium text-ink">{itemName(inv)}</td>
                        <td className="px-4 py-3 text-muted">{inv.categoryName}</td>
                        <td className="px-4 py-3 text-right text-muted">
                          {formatPaise(inv.pricePaise)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {inv.stockQty != null ? inv.stockQty : t('report.unlimited')}
                        </td>
                        <td className="px-5 py-3 text-center">
                          {inv.isSoldOut ? (
                            <Badge tone="danger">{t('report.soldOut')}</Badge>
                          ) : inv.stockQty != null && inv.stockQty <= 0 ? (
                            <Badge tone="danger">{t('report.outOfStock')}</Badge>
                          ) : inv.isLowStock ? (
                            <Badge tone="rose">{t('report.lowStock')}</Badge>
                          ) : (
                            <Badge tone="emerald">{t('report.inStock')}</Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted text-sm">
                        {t('report.noRecords')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {/* Section F: Cashier-wise Performance Reports */}
      {data.cashierReports && data.cashierReports.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-wider text-muted uppercase">
            {t('report.cashierReports')}
          </h2>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3">{t('report.cashierName')}</th>
                    <th className="px-4 py-3 text-center">{t('report.transactions')}</th>
                    <th className="px-4 py-3 text-right">
                      <Icon icon={QrCode} /> {t('counter.upi')}
                    </th>
                    <th className="px-4 py-3 text-right">
                      <Icon icon={Banknote} /> {t('counter.cash')}
                    </th>
                    <th className="px-4 py-3 text-right">
                      <Icon icon={CreditCard} /> {t('counter.card')}
                    </th>
                    <th className="px-4 py-3 text-right">{t('report.totalCollections')}</th>
                    <th className="px-5 py-3 text-right">{t('report.lastTransaction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {data.cashierReports.map((c) => (
                    <tr key={c.cashierId} className="hover:bg-sand/20">
                      <td className="px-5 py-3 font-medium text-ink">{c.cashierName}</td>
                      <td className="px-4 py-3 text-center font-semibold">{c.transactionsCount}</td>
                      <td className="px-4 py-3 text-right text-muted">{formatPaise(c.qrPaise)}</td>
                      <td className="px-4 py-3 text-right text-muted">
                        {formatPaise(c.cashPaise)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted">
                        {formatPaise(c.cardPaise)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gold-deep">
                        {formatPaise(c.totalPaise)}
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-muted">
                        {c.lastTransactionAt ? dateTimeIST(c.lastTransactionAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      {/* Section G: Individual Sales Records Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold tracking-wider text-muted uppercase">
            {t('report.salesRecords')}
          </h2>
          <Link
            to="/shop/payments?tab=history"
            className="text-xs font-semibold text-gold-deep hover:underline"
          >
            <Icon icon={FileSpreadsheet} /> {t('payments.tabHistory')} →
          </Link>
        </div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                <tr>
                  <th className="px-5 py-3">{t('counter.orderCode')}</th>
                  <th className="px-4 py-3">{t('report.customerPhone')}</th>
                  <th className="px-4 py-3">{t('report.time')}</th>
                  <th className="px-4 py-3 text-center">{t('report.filterMethod')}</th>
                  <th className="px-4 py-3">{t('report.verificationSource')}</th>
                  <th className="px-5 py-3 text-right">{t('counter.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {data.salesRecords && data.salesRecords.length > 0 ? (
                  data.salesRecords.map((s) => (
                    <tr key={s.id} className="hover:bg-sand/20">
                      <td className="px-5 py-3 font-mono font-semibold text-ink">
                        {formatOrderCode(s.orderCode)}
                      </td>
                      <td className="px-4 py-3 text-muted">{staffPhoneMask(s.customerPhone)}</td>
                      <td className="px-4 py-3 text-xs text-muted">{dateTimeIST(s.completedAt)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          tone={
                            s.paymentMethod === 'upi'
                              ? 'gold'
                              : s.paymentMethod === 'cash'
                                ? 'emerald'
                                : 'plum'
                          }
                        >
                          {s.paymentMethod === 'upi'
                            ? t('report.methodUpi')
                            : t(`method.${s.paymentMethod}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s.verificationSource === 'cashier_confirmed' ? (
                          <span className="text-emerald font-medium">
                            <Icon icon={Check} /> {t('report.verified.cashier')}
                          </span>
                        ) : s.verificationSource === 'cash_received' ? (
                          <span className="text-emerald font-medium">
                            <Icon icon={Check} /> {t('report.verified.cash')}
                          </span>
                        ) : s.verificationSource === 'terminal_approved' ? (
                          <span className="text-emerald font-medium">
                            <Icon icon={Check} /> {t('report.verified.terminal')}
                          </span>
                        ) : (
                          <span className="text-muted">{t('report.verified.direct')}</span>
                        )}
                        {s.paymentReference && (
                          <span className="block font-mono text-[11px] text-muted">
                            Ref: {s.paymentReference}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-ink">
                        {formatPaise(s.finalTotalPaise)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted text-sm">
                      {t('report.noRecords')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}
