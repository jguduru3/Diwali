import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { ButtonLink, Card, EmptyState, Spinner, Stat } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useAdminLicences, useMetrics } from '../../lib/queries';

/** Per shop/day: booked, arrived, served, no-show rate, median arrive→serve minutes. */
export function Overview() {
  const { t } = useTranslation();
  const metrics = useMetrics();
  const pending = useAdminLicences('pending');
  if (metrics.isPending) return <Spinner label={t('common.loading')} />;
  if (metrics.error) return <ErrorText error={metrics.error} />;
  const rows = metrics.data.rows;
  const sum = (k: 'booked' | 'arrived' | 'served' | 'noShow') => rows.reduce((n, r) => n + r[k], 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={t('admin.listedShops')}
          value={`${metrics.data.visibleShops}/${metrics.data.totalShops}`}
          tone="gold"
        />
        <Stat label={t('report.booked')} value={sum('booked')} />
        <Stat label={t('report.arrived')} value={sum('arrived')} />
        <Stat label={t('report.served')} value={sum('served')} tone="emerald" />
        <Stat label={t('report.noShow')} value={sum('noShow')} tone="rose" />
      </div>

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
                <th className="px-4 py-3">{t('book.shop')}</th>
                <th className="px-4 py-3 text-right">{t('report.booked')}</th>
                <th className="px-4 py-3 text-right">{t('report.arrived')}</th>
                <th className="px-4 py-3 text-right">{t('report.served')}</th>
                <th className="px-4 py-3 text-right">{t('admin.noShowRate')}</th>
                <th className="px-4 py-3 text-right">{t('admin.median')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.shopCode}-${r.day}`} className="border-t border-line/70">
                  <td className="px-4 py-3 font-semibold">{dayIST(r.day)}</td>
                  <td className="px-4 py-3">{r.shopName}</td>
                  <td className="px-4 py-3 text-right">{r.booked}</td>
                  <td className="px-4 py-3 text-right">{r.arrived}</td>
                  <td className="px-4 py-3 text-right">{r.served}</td>
                  <td className="px-4 py-3 text-right">
                    {r.noShowRate == null ? '—' : `${r.noShowRate}%`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.medianArriveToServeMin == null
                      ? '—'
                      : t('admin.minutes', { n: r.medianArriveToServeMin })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
