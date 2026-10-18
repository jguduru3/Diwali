import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { StatusChip } from '../../components/StatusChip';
import { Button, ButtonLink, Card, EmptyState, Spinner, Stat } from '../../components/ui';
import { dayIST, slotRange, timeIST } from '../../lib/format';
import { useNoShow, useServe, useShopToday } from '../../lib/queries';

/** Today: slot rows with counts and visitors (polls every 10 s). */
export function ShopToday() {
  const { t } = useTranslation();
  const today = useShopToday();
  const serve = useServe();
  const noShow = useNoShow();

  if (today.isPending) return <Spinner label={t('common.loading')} />;
  if (today.error) return <ErrorText error={today.error} />;
  const all = today.data.slots.flatMap((s) => s.visits);
  const count = (st: string) => all.filter((v) => v.status === st).length;
  const withVisits = today.data.slots.filter((s) => s.visits.length > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('status.booked')} value={count('booked')} tone="gold" />
        <Stat label={t('status.arrived')} value={count('arrived')} tone="emerald" />
        <Stat label={t('status.served')} value={count('served')} />
        <Stat label={t('status.no_show')} value={count('no_show')} tone="rose" />
      </div>

      <div className="no-print flex flex-wrap gap-3">
        <ButtonLink to="/shop/counter" size="lg">
          ⌖ {t('shopApp.scanList')}
        </ButtonLink>
        <Button variant="secondary" size="lg" onClick={() => window.print()} disabled={!all.length}>
          🖨 {t('shopApp.printCodes')}
        </Button>
      </div>

      {withVisits.length === 0 ? (
        <EmptyState icon="🕯" title={t('shopApp.quietTitle')} body={t('shopApp.quietBody')} />
      ) : (
        <div className="print-area space-y-4">
          <p className="hidden font-bold print:block">
            {t('shopApp.printHeading', { date: dayIST(new Date()) })}
          </p>
          {withVisits.map((slot) => (
            <Card key={slot.id} className="overflow-hidden">
              <div className="flex items-center justify-between bg-sand/60 px-5 py-3">
                <p className="font-display text-lg font-semibold">
                  {slotRange(slot.startsAt, slot.endsAt)}
                </p>
                <p className="text-sm text-muted">
                  {t('shopApp.capacity', { booked: slot.booked, capacity: slot.capacity })}
                </p>
              </div>
              <ul className="divide-y divide-line/70">
                {slot.visits.map((v) => (
                  <li key={v.code} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="font-mono text-lg font-bold tracking-widest text-plum">
                      {v.code}
                    </span>
                    <StatusChip status={v.status} bayNo={v.bayNo} />
                    {v.vehicle && (
                      <span className="text-sm text-muted">{t(`vehicle.${v.vehicle}`)}</span>
                    )}
                    {v.arrivedAt && (
                      <span className="text-sm text-muted">
                        {t('shopApp.arrivedAt', { time: timeIST(v.arrivedAt) })}
                      </span>
                    )}
                    {(v.status === 'booked' || v.status === 'arrived') && (
                      <span className="no-print ml-auto flex gap-2">
                        <Button
                          size="sm"
                          variant="success"
                          disabled={serve.isPending}
                          onClick={() => serve.mutate(v.code)}
                        >
                          {t('shopApp.markServed')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={noShow.isPending}
                          onClick={() => noShow.mutate(v.code)}
                        >
                          {t('shopApp.noShow')}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <ErrorText error={serve.error ?? noShow.error} />
    </div>
  );
}
