import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ORDER_STATUSES, formatPaise, type AdminOrder } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
} from '../../components/ui';
import { dayIST, timeIST } from '../../lib/format';
import { useAdminOrders, useRefundFee } from '../../lib/queries';

function OrderRow({ o }: { o: AdminOrder }) {
  const { t } = useTranslation();
  const refund = useRefundFee();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const refundable =
    o.fee.status === 'paid' || o.fee.status === 'kept' || o.fee.status === 'refund_failed';
  return (
    <Card as="li" className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            <span className="font-mono">{o.code}</span> · {o.shopName} ({o.shopCode}) · {o.customer}
          </p>
          <p className="text-sm text-muted">
            {o.placedAt && `${dayIST(o.placedAt)} ${timeIST(o.placedAt)}`}
            {o.finalTotalPaise != null && ` · ${formatPaise(o.finalTotalPaise)}`}
          </p>
        </div>
        <Badge
          tone={
            o.fee.status === 'refunded'
              ? 'emerald'
              : o.fee.status === 'refund_failed'
                ? 'danger'
                : 'muted'
          }
        >
          {t(`fee.${o.fee.status}`)}
        </Badge>
        <OrderStatusChip status={o.status} staff />
        {refundable && !open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {t('admin.refundFee')}
          </Button>
        )}
      </div>
      {open && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-line/70 pt-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            refund.mutate({ id: o.id, reason }, { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label={t('admin.refundReason')} className="min-w-64 flex-1">
            <Input
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button variant="danger" disabled={refund.isPending}>
            {t('admin.refundFee')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      {refund.isSuccess && (
        <Notice tone="emerald" className="mt-3">
          {t('admin.refundSent')}
        </Notice>
      )}
      <ErrorText error={refund.error} />
    </Card>
  );
}

/** Admin: find orders, see the ₹30 fee state, refund the fee by hand when needed. */
export function AdminOrders() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const orders = useAdminOrders(query, status);
  return (
    <div className="space-y-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Field label={t('admin.search')} hint={t('admin.ordersHelp')} className="min-w-64 flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label={t('members.role')} className="w-56">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.allStatuses')}</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`staffStatus.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button>{t('admin.search')}</Button>
      </form>
      {orders.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={orders.error} />
      {orders.data?.length === 0 && <EmptyState title={t('admin.noOrders')} />}
      <ul className="space-y-3">
        {orders.data?.map((o) => (
          <OrderRow key={o.id} o={o} />
        ))}
      </ul>
    </div>
  );
}
