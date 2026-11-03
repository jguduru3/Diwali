import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPaise, type StaffOrderSummary } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Segmented,
  Spinner,
} from '../../components/ui';
import { dayIST, timeIST } from '../../lib/format';
import { useConfirmOrder, useRejectOrder, useShopOrders, type OrdersView } from '../../lib/queries';

function Row({ o, actions }: { o: StaffOrderSummary; actions: boolean }) {
  const { t } = useTranslation();
  const confirm = useConfirmOrder();
  const reject = useRejectOrder();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(t('shopOrders.rejectDefault'));
  return (
    <Card as="li" className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            <span className="font-mono">{o.code}</span> · {o.customer}
          </p>
          <p className="text-sm text-muted">
            {t('shopOrders.items', { count: o.lineCount })} ·{' '}
            {t('shopOrders.estimate', { total: formatPaise(o.estimatedTotalPaise) })}
            {o.placedAt && ` · ${dayIST(o.placedAt)} ${timeIST(o.placedAt)}`}
          </p>
          {o.status === 'placed' && o.confirmBy && (
            <p className="text-sm font-semibold text-gold-deep">
              {t('shopOrders.confirmBy', {
                date: `${dayIST(o.confirmBy)} ${timeIST(o.confirmBy)}`,
              })}
            </p>
          )}
        </div>
        {o.packNo && (
          <span className="font-display text-2xl font-semibold text-plum">#{o.packNo}</span>
        )}
        {o.openDecisions > 0 && (
          <Badge tone="saffron">{t('shopOrders.openDecisions', { count: o.openDecisions })}</Badge>
        )}
        <OrderStatusChip status={o.status} staff />
      </div>
      {actions && o.status === 'placed' && (
        <div className="mt-3 border-t border-line/70 pt-3">
          {rejecting ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                reject.mutate({ id: o.id, body: { reason } });
              }}
            >
              <Field label={t('shopOrders.rejectReason')} className="min-w-64 flex-1">
                <Input
                  required
                  minLength={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button variant="danger" disabled={reject.isPending}>
                {t('shopOrders.rejectSend')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                {t('common.cancel')}
              </Button>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="success"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate({ id: o.id })}
              >
                ✓ {t('shopOrders.confirm')}
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(true)}>
                {t('shopOrders.reject')}
              </Button>
            </div>
          )}
          <ErrorText error={confirm.error ?? reject.error} />
        </div>
      )}
    </Card>
  );
}

/** Merchant's order board: confirm new orders within 3 days (or the customer's fee is refunded). */
export function Orders() {
  const { t } = useTranslation();
  const [view, setView] = useState<OrdersView>('incoming');
  const orders = useShopOrders(view);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('shopApp.tabs.orders')}
          value={view}
          onChange={setView}
          options={[
            { value: 'incoming', label: t('shopOrders.incoming') },
            { value: 'packing', label: t('shopOrders.inProgress') },
            { value: 'counter', label: t('shopOrders.ready') },
            { value: 'done', label: t('shopOrders.done') },
          ]}
        />
        <p className="text-xs text-muted">{t('shopOrders.refresh')}</p>
      </div>
      {orders.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={orders.error} />
      {orders.data?.length === 0 && (
        <EmptyState
          icon="🧾"
          title={view === 'incoming' ? t('shopOrders.emptyIncoming') : t('shopOrders.empty')}
        />
      )}
      <ul className="space-y-3">
        {orders.data?.map((o) => (
          <Row key={o.id} o={o} actions={view === 'incoming'} />
        ))}
      </ul>
    </div>
  );
}
