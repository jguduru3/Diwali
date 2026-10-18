import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { ButtonLink, Card, EmptyState, Spinner, Stat } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useAdminLicences, useMetrics } from '../../lib/queries';

/** Orders, platform fees and refunds per day; merchant sales for reconciliation only (G4). */
export function Overview() {
  const { t } = useTranslation();
  const metrics = useMetrics();
  const pending = useAdminLicences('pending');
  if (metrics.isPending) return <Spinner label={t('common.loading')} />;
  if (metrics.error) return <ErrorText error={metrics.error} />;
  const { rows, totals } = metrics.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('admin.listedShops')}
          value={`${metrics.data.visibleShops}/${metrics.data.totalShops}`}
          tone="gold"
        />
        <Stat label={t('admin.ordersPlaced')} value={totals.ordersPlaced} />
        <Stat label={t('admin.completed')} value={totals.completed} tone="emerald" />
        <Stat label={t('admin.awaiting')} value={totals.awaitingMerchant} tone="rose" />
        <Stat label={t('admin.fees')} value={formatPaise(totals.feesPaise)} />
        <Stat label={t('admin.refunds')} value={formatPaise(totals.refundsPaise)} tone="rose" />
        <Stat label={t('admin.netFees')} value={formatPaise(totals.netFeesPaise)} tone="emerald" />
        <Stat label={t('admin.sales')} value={formatPaise(totals.salesPaise)} />
      </div>
      <p className="text-xs text-muted">{t('admin.salesNote')}</p>

      {!!pending.data?.length && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-gold/50 bg-gold-light/25 p-5">
          <p className="font-semibold">
            {t('admin.pendingLicences', { count: pending.data.length })}
          </p>
          <ButtonLink to="/admin/licences">{t('admin.review')} →</ButtonLink>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="📊" title={t('report.emptyTitle')} body={t('admin.metricsEmpty')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-sand/70 text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-4 py-3">{t('admin.day')}</th>
                <th className="px-4 py-3 text-right">{t('admin.ordersPlaced')}</th>
                <th className="px-4 py-3 text-right">{t('admin.completed')}</th>
                <th className="px-4 py-3 text-right">{t('admin.cancelled')}</th>
                <th className="px-4 py-3 text-right">{t('admin.fees')}</th>
                <th className="px-4 py-3 text-right">{t('admin.refunds')}</th>
                <th className="px-4 py-3 text-right">{t('admin.sales')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-t border-line/70">
                  <td className="px-4 py-3 font-semibold">{dayIST(r.day)}</td>
                  <td className="px-4 py-3 text-right">{r.ordersPlaced}</td>
                  <td className="px-4 py-3 text-right">{r.completed}</td>
                  <td className="px-4 py-3 text-right">{r.cancelled}</td>
                  <td className="px-4 py-3 text-right">{formatPaise(r.feesPaise)}</td>
                  <td className="px-4 py-3 text-right">{formatPaise(r.refundsPaise)}</td>
                  <td className="px-4 py-3 text-right">{formatPaise(r.salesPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
