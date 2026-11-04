import { useTranslation } from 'react-i18next';
import { PhoneCall } from 'lucide-react';
import { useCallCustomer } from '../lib/queries';
import { ErrorText } from './ErrorText';
import { Icon } from './Icon';
import { Button, cx } from './ui';

/**
 * Call the customer about an order from this phone's dialer (G9, amended 2026-11-04). The server
 * logs the call and returns the number; hidden when the order is closed (`canCall`).
 */
export function CallCustomerButton({
  orderId,
  canCall,
  className,
}: {
  orderId: string;
  canCall: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const call = useCallCustomer();
  if (!canCall) return null;
  return (
    <div className={cx('space-y-1', className)}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={call.isPending}
        title={t('callCustomer.hint')}
        onClick={() =>
          call.mutate(orderId, {
            onSuccess: ({ phone }) => {
              window.location.href = `tel:${phone}`;
            },
          })
        }
      >
        <Icon icon={PhoneCall} className="h-4 w-4" />
        {call.isPending ? t('callCustomer.calling') : t('callCustomer.button')}
      </Button>
      <ErrorText error={call.error} />
    </div>
  );
}
