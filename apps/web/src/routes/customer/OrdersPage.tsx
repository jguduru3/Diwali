import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { ButtonLink, Card, EmptyState, PageTitle, Spinner } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useMyOrders } from '../../lib/queries';

export function OrdersPage() {
  const { t } = useTranslation();
  const orders = useMyOrders();
  if (orders.isPending) return <Spinner label={t('common.loading')} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={t('order.listTitle')} />
      <ErrorText error={orders.error} />
      {orders.data?.length === 0 && (
        <EmptyState
          icon="🧾"
          title={t('order.noneTitle')}
          body={t('order.noneBody')}
          action={<ButtonLink to="/">{t('home.cta')}</ButtonLink>}
        />
      )}
      <ul className="space-y-3">
        {orders.data?.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 p-4 transition hover:ring-2 hover:ring-gold/50">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {o.shopName} · <span className="font-mono">{o.code}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {o.placedAt && `${dayIST(o.placedAt)} · `}
                    {t('plan.items', { count: o.lineCount })} ·{' '}
                    {formatPaise(o.finalTotalPaise ?? o.estimatedTotalPaise)}
                  </p>
                </div>
                {o.packNo && (
                  <span className="font-display text-xl font-semibold text-plum">#{o.packNo}</span>
                )}
                <OrderStatusChip status={o.status} />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
