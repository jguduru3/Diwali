import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '@pataka/shared';
import { Badge } from './ui';

const tone = {
  fee_pending: 'muted',
  placed: 'gold',
  confirmed: 'plum',
  packing: 'plum',
  awaiting_customer: 'saffron',
  packed: 'emerald',
  completed: 'emerald',
  cancelled: 'muted',
  rejected: 'danger',
  expired: 'muted',
} as const;

/** Customer wording by default; `staff` uses the merchant's wording. */
export function OrderStatusChip({
  status,
  staff = false,
}: {
  status: OrderStatus;
  staff?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Badge tone={tone[status]}>{t(`${staff ? 'staffStatus' : 'orderStatus'}.${status}`)}</Badge>
  );
}
