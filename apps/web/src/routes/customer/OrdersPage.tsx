import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FINAL_ORDER_STATUSES,
  formatPaise,
  type CustomerOrderSummary,
  type OrderStatus,
} from '@pataka/shared';
import { CalendarIcon } from '../../components/CalendarIcon';
import { ErrorText } from '../../components/ErrorText';
import { OrderLineRow } from '../../components/OrderLineRow';
import { OrderAccent, OrderTracker, ShopBadge } from '../../components/OrderProgress';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { ButtonLink, Card, EmptyState, PageTitle, Spinner, cx } from '../../components/ui';
import { dayIST, timeIST } from '../../lib/format';
import { useMyOrders } from '../../lib/queries';
import { ReceiptText } from 'lucide-react';
import { Icon } from '../../components/Icon';

const when = (iso: string) => `${dayIST(iso)}, ${timeIST(iso)}`;

/** The one thing the customer should know or do next, when there is one. */
function NextStep({ order: o }: { order: CustomerOrderSummary }) {
  const { t } = useTranslation();
  const text =
    o.status === 'fee_pending'
      ? t('order.feeHelp')
      : o.status === 'awaiting_customer'
        ? t('order.decisionsTitle')
        : null;
  if (!text) return null;
  return (
    <p className="rounded-2xl bg-saffron/12 px-4 py-3 text-sm font-semibold text-saffron">{text}</p>
  );
}

/** Full-width banner that leads a ready order's card: what to do, and the pack number to ask for. */
function ReadyBanner({ packNo }: { packNo: number | null }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex items-center gap-4 overflow-hidden bg-emerald px-5 py-4 text-white">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-6 h-32 w-32 rounded-full bg-white/10 blur-2xl"
      />
      <span
        aria-hidden
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 ring-1 ring-white/40"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6">
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="font-display text-2xl leading-tight font-semibold">
          {t('orderStatus.packed')}
        </p>
        <p className="mt-0.5 text-sm text-white/85">{t('order.readyHint')}</p>
      </div>
      {packNo != null && (
        <div className="relative shrink-0 rounded-2xl bg-white px-3.5 py-2 text-center text-emerald shadow-[var(--shadow-card)]">
          <p className="text-[10px] font-bold tracking-wider uppercase">{t('order.packLabel')}</p>
          <p className="font-display text-3xl leading-none font-semibold">#{packNo}</p>
        </div>
      )}
    </div>
  );
}

function OrderCard({ order: o }: { order: CustomerOrderSummary }) {
  const { t } = useTranslation();
  const ended =
    (FINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(o.status) && o.status !== 'completed';
  const ready = o.status === 'packed';
  return (
    <Link
      to={`/orders/${o.id}`}
      className="group block rounded-3xl focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <Card
        className={cx(
          'overflow-hidden p-0 transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-lift)]',
          ended && 'opacity-75',
          ready && 'shadow-[0_14px_36px_-14px_rgb(27_138_90/0.55)] ring-2 ring-emerald',
        )}
      >
        {ready ? <ReadyBanner packNo={o.packNo} /> : <OrderAccent status={o.status} />}

        <div className="space-y-5 p-5">
          {/* On phones the status chip drops to its own row under the name. */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <ShopBadge name={o.shopName} />
            <div className="min-w-0 flex-1">
              <p className="text-lg leading-tight font-semibold">{o.shopName}</p>
              <p className="mt-1 flex flex-col gap-1 text-sm text-muted sm:flex-row sm:items-center sm:gap-3">
                <span className="font-mono">{o.code}</span>
                {o.placedAt && (
                  <span className="flex items-center gap-1.5 text-ink">
                    <CalendarIcon className="h-4 w-4 shrink-0 text-gold-deep" />
                    {t('order.placedOn', { date: when(o.placedAt) })}
                  </span>
                )}
              </p>
            </div>
            {!ready && (
              <div className="basis-full pl-14 sm:basis-auto sm:pl-0">
                <OrderStatusChip status={o.status} />
              </div>
            )}
          </div>

          <OrderTracker status={o.status} />
          <NextStep order={o} />

          <ul className="divide-y divide-line/70 rounded-2xl border border-line/70 px-3">
            {o.lines.map((l, i) => (
              <OrderLineRow key={i} line={l} compact />
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line/70 bg-sand/40 px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              {o.finalTotalPaise != null ? t('order.final') : t('order.estimated')}
            </p>
            <p className="font-display text-3xl leading-tight font-semibold text-plum">
              {formatPaise(o.finalTotalPaise ?? o.estimatedTotalPaise)}
            </p>
          </div>
          <span
            className={cx(
              'inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold shadow-[var(--shadow-card)] transition',
              ready
                ? 'min-h-11 bg-emerald px-5 text-white group-hover:brightness-110'
                : 'bg-white text-plum group-hover:bg-plum group-hover:text-white',
            )}
          >
            {ready ? t('order.loadQr') : t('order.view')}
            <span aria-hidden className="transition group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </div>
      </Card>
    </Link>
  );
}

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
          icon={<Icon icon={ReceiptText} className="h-6 w-6" />}
          title={t('order.noneTitle')}
          body={t('order.noneBody')}
          action={<ButtonLink to="/">{t('home.cta')}</ButtonLink>}
        />
      )}
      <ul className="space-y-5">
        {[...(orders.data ?? [])]
          .sort((a, b) => Number(b.status === 'packed') - Number(a.status === 'packed'))
          .map((o) => (
            <li key={o.id}>
              <OrderCard order={o} />
            </li>
          ))}
      </ul>
    </div>
  );
}
