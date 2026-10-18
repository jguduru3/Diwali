import { useTranslation } from 'react-i18next';
import type { VisitStatus } from '@pataka/shared';
import { Badge } from './ui';

const tone = {
  booked: 'gold',
  arrived: 'emerald',
  served: 'plum',
  no_show: 'danger',
  cancelled: 'muted',
} as const;

export function StatusChip({ status, bayNo }: { status: VisitStatus; bayNo?: number | null }) {
  const { t } = useTranslation();
  return (
    <Badge tone={tone[status]}>
      {t(`status.${status}`)}
      {status === 'arrived' && bayNo ? ` · ${t('ticket.bay', { n: bayNo })}` : ''}
    </Badge>
  );
}
