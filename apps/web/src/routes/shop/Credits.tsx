import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, Card, Notice, Spinner, Stat } from '../../components/ui';
import { dateTimeIST, dayIST } from '../../lib/format';
import { useRequestSettlement, useShopSettlements } from '../../lib/growth';

/** Owner: platform credit customers used on bills, owed to the shop and paid by the platform. */
export function Credits() {
  const { t } = useTranslation();
  const s = useShopSettlements();
  const request = useRequestSettlement();
  if (s.isPending) return <Spinner label={t('common.loading')} />;
  if (s.error) return <ErrorText error={s.error} />;
  return (
    <div className="space-y-5">
      <Notice>{t('settle.explain')}</Notice>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label={t('settle.owed')} value={formatPaise(s.data.owedPaise)} />
        <Card className="flex flex-col justify-center gap-2 p-5">
          <Button
            disabled={!s.data.canRequestToday || request.isPending}
            onClick={() => request.mutate(undefined)}
          >
            {t('settle.request')}
          </Button>
          <p className="text-xs text-muted">{t('settle.requestHelp')}</p>
          <ErrorText error={request.error} />
        </Card>
      </div>
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-bold">{t('settle.history')}</h2>
        {s.data.settlements.length === 0 && (
          <p className="text-sm text-muted">{t('settle.none')}</p>
        )}
        <ul className="divide-y divide-line">
          {s.data.settlements.map((x) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span>
                <span className="font-semibold tabular-nums">{formatPaise(x.amountPaise)}</span>
                <span className="text-muted">
                  {' · '}
                  {x.mode === 'weekly' && x.periodStart && x.periodEnd
                    ? t('settle.week', { from: dayIST(x.periodStart), to: dayIST(x.periodEnd) })
                    : t('settle.requested', { date: dateTimeIST(x.createdAt) })}
                  {' · '}
                  {t('settle.bills', { count: x.bills })}
                </span>
                {x.utr && <span className="block text-xs text-muted">UTR {x.utr}</span>}
              </span>
              <Badge tone={x.status === 'paid' ? 'emerald' : 'gold'}>
                {t(`settle.status.${x.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
