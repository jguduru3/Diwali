import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Button, ButtonLink, Card, Notice, Spinner } from '../../components/ui';
import { useMockCheckout, useMockComplete } from '../../lib/queries';

/**
 * Hosted page of the MOCK payment provider (dev/demo only; the API refuses it
 * in prod). A real provider hosts its own page; nothing here is trusted — the
 * order changes only when the signed provider event is applied server-side.
 */
export function MockPayPage() {
  const { t } = useTranslation();
  const checkoutId = useParams().checkoutId ?? '';
  const checkout = useMockCheckout(checkoutId);
  const complete = useMockComplete(checkoutId);

  if (checkout.isPending) return <Spinner label={t('common.loading')} />;
  if (!checkout.data) return <ErrorText error={checkout.error} />;
  const c = checkout.data;
  const orderId = complete.data?.orderId;
  const paid = c.status === 'captured' || complete.data?.outcome === 'placed';

  return (
    <Card className="mx-auto max-w-md p-6 sm:p-8">
      <p className="text-xs font-bold tracking-[0.18em] text-gold-deep uppercase">
        {t('mockPay.eyebrow')}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{t('mockPay.title')}</h1>
      <p className="mt-2 text-sm text-muted">{t('mockPay.body')}</p>
      <div className="my-6 rounded-2xl bg-sand p-4 text-center">
        <p className="text-sm text-muted">{t('mockPay.order', { code: c.orderCode })}</p>
        <p className="font-display text-4xl font-semibold">{formatPaise(c.amountPaise)}</p>
      </div>
      {paid ? (
        <Notice tone="emerald">{t('mockPay.done')}</Notice>
      ) : complete.data?.outcome === 'payment_failed' ? (
        <Notice tone="danger">{t('mockPay.failed')}</Notice>
      ) : (
        <div className="grid gap-3">
          <Button
            size="lg"
            disabled={complete.isPending}
            onClick={() => complete.mutate('success')}
          >
            {t('mockPay.pay', { amount: formatPaise(c.amountPaise) })}
          </Button>
          <Button
            variant="ghost"
            disabled={complete.isPending}
            onClick={() => complete.mutate('fail')}
          >
            {t('mockPay.fail')}
          </Button>
        </div>
      )}
      <ErrorText error={complete.error} />
      {orderId && (
        <ButtonLink to={`/orders/${orderId}`} variant="secondary" className="mt-4 w-full">
          {t('mockPay.toOrder')}
        </ButtonLink>
      )}
    </Card>
  );
}
