import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Card, EmptyState, Spinner, Stat } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useShopStats } from '../../lib/queries';

/** Footfall per day — visitors only, never money (G4). */
export function Report() {
  const { t } = useTranslation();
  const stats = useShopStats();
  if (stats.isPending) return <Spinner label={t('common.loading')} />;
  if (stats.error) return <ErrorText error={stats.error} />;
  const rows = stats.data.rows;
  const sum = (k: 'booked' | 'arrived' | 'served' | 'noShow') => rows.reduce((n, r) => n + r[k], 0);
  const max = Math.max(1, ...rows.map((r) => r.booked));

  if (!rows.length)
    return <EmptyState icon="📈" title={t('report.emptyTitle')} body={t('report.emptyBody')} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('report.booked')} value={sum('booked')} />
        <Stat label={t('report.arrived')} value={sum('arrived')} tone="gold" />
        <Stat label={t('report.served')} value={sum('served')} tone="emerald" />
        <Stat label={t('report.noShow')} value={sum('noShow')} tone="rose" />
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
                  style={{ width: `${(r.booked / max) * 100}%` }}
                />
                <span
                  className="absolute inset-y-0 left-0 rounded-lg bg-emerald/70"
                  style={{ width: `${(r.served / max) * 100}%` }}
                />
              </span>
              <span className="text-right text-muted">
                {t('report.row', { booked: r.booked, served: r.served, noShow: r.noShow })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
