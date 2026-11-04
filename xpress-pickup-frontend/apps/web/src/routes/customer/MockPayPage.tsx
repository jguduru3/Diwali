import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Button, ButtonLink, Card, Notice, Spinner } from '../../components/ui';
import { useMockCheckout, useMockComplete } from '../../lib/queries';
import { nextAfter } from '../../lib/payQueue';

/**
 * Hosted page of the MOCK payment provider (dev/demo only; the API refuses it
 * in prod). A real provider hosts its own page; nothing here is trusted — the
 * order changes only when the signed provider event is applied server-side.
 */
/** Keyed by checkout, so moving on to the next shop's fee starts a fresh page. */
export function MockPayPage() {
  const checkoutId = useParams().checkoutId ?? '';
  return <MockPayCheckout key={checkoutId} checkoutId={checkoutId} />;
}

function MockPayCheckout({ checkoutId }: { checkoutId: string }) {
  const { t } = useTranslation();
  const checkout = useMockCheckout(checkoutId);
  const complete = useMockComplete(checkoutId);
  const navigate = useNavigate();
  const placedOrderId = complete.data?.outcome === 'placed' ? complete.data.orderId : undefined;
  // After a successful payment go straight to the order (replace, so Back doesn't return here).
  useEffect(() => {
    if (!placedOrderId) return;
    // Several shops in one checkout: go on to the next shop's fee, else to the order.
    const next = nextAfter(placedOrderId);
    const to = next ? next.url : `/orders/${placedOrderId}`;
    const id = setTimeout(() => navigate(to, { replace: true }), 1200);
    return () => clearTimeout(id);
  }, [placedOrderId, navigate]);

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
      <h1 className="mt-1 text-2xl font-extrabold">{t('mockPay.title')}</h1>
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
