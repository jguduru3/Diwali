import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Card, EmptyState, Spinner, Stat } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useShopStats } from '../../lib/queries';

/** The merchant's own orders and sales per day. The platform takes no commission (G4). */
export function Report() {
  const { t } = useTranslation();
  const stats = useShopStats();
  if (stats.isPending) return <Spinner label={t('common.loading')} />;
  if (stats.error) return <ErrorText error={stats.error} />;
  const rows = stats.data.rows;
  const sum = (k: 'orders' | 'completed' | 'cancelled' | 'salesPaise') =>
    rows.reduce((n, r) => n + r[k], 0);
  const max = Math.max(1, ...rows.map((r) => r.orders));

  if (!rows.length)
    return <EmptyState icon="📈" title={t('report.emptyTitle')} body={t('report.emptyBody')} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('report.orders')} value={sum('orders')} />
        <Stat label={t('report.completed')} value={sum('completed')} tone="emerald" />
        <Stat label={t('report.cancelled')} value={sum('cancelled')} tone="rose" />
        <Stat label={t('report.sales')} value={formatPaise(sum('salesPaise'))} tone="gold" />
      </div>
      <Card className="p-6">
        <h2 className="mb-1 text-xl font-semibold">{t('report.perDay')}</h2>
        <p className="mb-5 text-sm text-muted">{t('report.note')}</p>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.day} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="font-semibold">{dayIST(r.day)}</span>
              <span className="relative h-7 overflow-hidden rounded-lg bg-sand" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 rounded-lg bg-gold-light"
                  style={{ width: `${(r.orders / max) * 100}%` }}
                />
                <span
                  className="absolute inset-y-0 left-0 rounded-lg bg-emerald/70"
                  style={{ width: `${(r.completed / max) * 100}%` }}
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
    </div>
  );
}
