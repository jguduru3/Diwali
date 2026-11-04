import { useTranslation } from 'react-i18next';
import { PhoneCall } from 'lucide-react';
import { useCallCustomer } from '../lib/queries';
import { ErrorText } from './ErrorText';
import { Icon } from './Icon';
import { Button, cx } from './ui';

/**
 * Call the customer about an order. The calling provider rings this staff member's phone first,
 * then the customer's, so the shop never sees the customer's number (G9). Hidden when calling
 * is off or the order is closed (`canCall` from the server).
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
        onClick={() => call.mutate(orderId)}
      >
        <Icon icon={PhoneCall} className="h-4 w-4" />
        {call.isPending ? t('callCustomer.calling') : t('callCustomer.button')}
      </Button>
      {call.isSuccess && (
        <p role="status" className="text-xs font-semibold text-emerald">
          {t('callCustomer.ringing')}
        </p>
      )}
      <ErrorText error={call.error} />
    </div>
  );
}
