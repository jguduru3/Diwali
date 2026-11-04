import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFeePaise } from '../../lib/settings';
import { formatPaise, type Bill, type CustomerOrder, type OrderLine } from '@pataka/shared';
import { CalendarIcon } from '../../components/CalendarIcon';
import { ErrorText } from '../../components/ErrorText';
import { OrderLineRow } from '../../components/OrderLineRow';
import { OrderAccent, OrderTracker, ShopBadge } from '../../components/OrderProgress';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { QrCode } from '../../components/QrCode';
import { SafetyNotice } from '../../components/SafetyNotice';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  Notice,
  Spinner,
  Textarea,
  cx,
} from '../../components/ui';
import { dayIST, itemName, timeIST } from '../../lib/format';
import { loadPickupQr } from '../../lib/orderStore';
import { nextAfter, payQueue, peekNext } from '../../lib/payQueue';
import {
  useCancelOrder,
  useDecision,
  useNotifyArrival,
  useOrder,
  usePickupQr,
  useRequestAssistance,
  useStartFee,
} from '../../lib/queries';
import { Printer, ReceiptText } from 'lucide-react';
import { Icon } from '../../components/Icon';

const when = (iso: string) => `${dayIST(iso)}, ${timeIST(iso)}`;

/** Printable bill (G8: carries the safety notice). Also used at the counter. */
export function BillView({ bill }: { bill: Bill }) {
  const { t } = useTranslation();
  return (
    <Card className="print-area p-6">
      <div className="text-center">
        <p className="font-display text-xl font-semibold">{bill.shop.name}</p>
        {bill.shop.address && <p className="text-xs text-muted">{bill.shop.address}</p>}
        {bill.shop.licenceNo && (
          <p className="text-xs text-muted">{t('order.licenceNo', { no: bill.shop.licenceNo })}</p>
        )}
        <p className="mt-2 text-sm font-semibold">
          {t('order.billNo', { no: bill.billNo })} · {bill.orderCode}
        </p>
        <p className="text-xs text-muted">{when(bill.issuedAt)}</p>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted uppercase">
            <th className="py-2">{t('counter.item')}</th>
            <th className="py-2 text-right">{t('counter.qty')}</th>
            <th className="py-2 text-right">{t('counter.rate')}</th>
            <th className="py-2 text-right">{t('counter.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={i} className="border-b border-line/60">
              <td className="py-2 pr-2">{itemName(l)}</td>
              <td className="py-2 text-right">{l.qty}</td>
              <td className="py-2 text-right">{formatPaise(l.unitPricePaise)}</td>
              <td className="py-2 text-right font-semibold">{formatPaise(l.totalPaise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-4 font-display text-lg font-semibold">
              {t('counter.total')}
            </td>
            <td className="pt-4 text-right font-display text-2xl font-semibold">
              {formatPaise(bill.totalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-4 text-center text-sm font-semibold">
        {t('order.paidBy', { method: t(`method.${bill.payment.method}`) })}
        {bill.payment.reference && ` · ${t('order.ref', { ref: bill.payment.reference })}`}
      </p>
      <p className="mt-3 border-t border-dashed border-line pt-3 text-center text-[11px] text-muted">
        {t('safety.notice')}
      </p>
    </Card>
  );
}

function Decision({ order, line }: { order: CustomerOrder; line: OrderLine }) {
  const { t } = useTranslation();
  const decide = useDecision(order.id);
  const name = itemName(line);
  return (
    <Card className="p-4">
      {line.status === 'out_of_stock' ? (
        <>
          <p className="font-semibold">{t('order.oosBody', { name })}</p>
          <Button
            className="mt-3"
            variant="dark"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ lineId: line.id, decision: 'remove' })}
          >
            {t('order.remove')}
          </Button>
        </>
      ) : (
        <>
          <p className="font-semibold">
            {t('order.altBody', {
              name,
              alt: line.alternate ? itemName(line.alternate) : '',
              qty: line.alternate?.qty,
              price: formatPaise(line.alternate?.unitPricePaise ?? 0),
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="success"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ lineId: line.id, decision: 'accept' })}
            >
              {t('order.accept')}
            </Button>
            <Button
              variant="secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ lineId: line.id, decision: 'decline' })}
            >
              {t('order.decline')}
            </Button>
          </div>
        </>
      )}
      <ErrorText error={decide.error} />
    </Card>
  );
}

function PickupQr({ order }: { order: CustomerOrder }) {
  const { t } = useTranslation();
  const qr = usePickupQr(order.id);
  const [showText, setShowText] = useState(false);
  const saved = loadPickupQr(order.id);
  const text = qr.data?.qr ?? saved;
  return (
    <Card className="overflow-hidden">
      {/* Same green as the ready banner on My orders, so "ready" looks the same everywhere. */}
      <div className="relative overflow-hidden bg-emerald px-6 pt-6 pb-7 text-white">
        <span
          aria-hidden
          className="pointer-events-none absolute -top-12 -right-8 h-40 w-40 rounded-full bg-white/10 blur-2xl"
        />
        <p className="relative flex items-center gap-2 text-xs font-bold tracking-[0.2em] uppercase">
          <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('order.readyTitle')}
        </p>
        <p className="relative mt-2 font-display text-5xl font-semibold">
          {t('order.packNo', { n: order.packNo })}
        </p>
        <p className="relative mt-1 text-white/85">{order.shop.name}</p>
      </div>
      <div className="space-y-4 p-6">
        {text ? (
          <>
            <div className="mx-auto w-full max-w-[18rem] rounded-3xl bg-white p-3 ring-1 ring-line">
              <QrCode
                text={text}
                label={t('order.pickupQrLabel', { code: order.code })}
                className="[&>svg]:h-auto [&>svg]:w-full"
              />
            </div>
            <p className="text-center text-sm text-muted">{t('order.showQr')}</p>
            {qr.isError && saved && <Notice>{t('order.qrOffline')}</Notice>}
            <div className="text-center">
              <Button variant="ghost" size="sm" onClick={() => setShowText((v) => !v)}>
                {showText ? t('order.hideText') : t('order.showText')}
              </Button>
              {showText && (
                <p className="mt-2 rounded-2xl bg-sand px-4 py-3 font-mono text-xs break-all select-all">
                  {text}
                </p>
              )}
            </div>
            <Button
              variant="secondary"
              className="w-full"
              disabled={qr.isPending}
              onClick={() => qr.mutate()}
            >
              {t('order.refreshQr')}
            </Button>
          </>
        ) : (
          <Button size="lg" className="w-full" disabled={qr.isPending} onClick={() => qr.mutate()}>
            {t('order.loadQr')}
          </Button>
        )}
        <ErrorText error={qr.error} />
        <p className="text-center text-xs font-semibold text-muted">{t('order.payAtShop')}</p>
        <SafetyNotice />
      </div>
    </Card>
  );
}

/** Small round icon tile that heads each section card. */
function SectionIcon({ children, tone = 'plum' }: { children: ReactNode; tone?: 'plum' | 'gold' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
        tone === 'plum' ? 'bg-plum/10 text-plum' : 'bg-gold-light/60 text-gold-deep',
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        {children}
      </svg>
    </span>
  );
}

const BagIcon = () => (
  <>
    <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </>
);
const PinIcon = () => (
  <>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </>
);
const CarIcon = () => (
  <>
    <path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5" />
    <path d="M4 16.5h16M5 12h14" />
    <circle cx="8" cy="16.5" r="1.6" />
    <circle cx="16" cy="16.5" r="1.6" />
  </>
);

function SectionHead({
  icon,
  title,
  aside,
  tone,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  tone?: 'plum' | 'gold';
}) {
  return (
    <div className="flex items-center gap-3">
      <SectionIcon tone={tone}>{icon}</SectionIcon>
      <h2 className="flex-1 text-lg font-bold">{title}</h2>
      {aside}
    </div>
  );
}

const assistanceTone = { pending: 'gold', approved: 'emerald', rejected: 'danger' } as const;
const assistanceKey = {
  pending: 'order.assistanceStatusPending',
  approved: 'order.assistanceStatusApproved',
  rejected: 'order.assistanceStatusRejected',
} as const;

function PickupArrivalAssistanceCard({ order }: { order: CustomerOrder }) {
  const { t } = useTranslation();
  const notifyArrival = useNotifyArrival(order.id);
  const requestAssistance = useRequestAssistance(order.id);
  const [assistanceType, setAssistanceType] = useState<'bring_to_car' | 'other'>('bring_to_car');
  const [notes, setNotes] = useState('');

  const isArriving = order.arrivalStatus === 'on_the_way' || order.arrivalStatus === 'arrived';
  const assistance =
    order.assistanceStatus && order.assistanceStatus !== 'none' ? order.assistanceStatus : null;
  const options = [
    { value: 'bring_to_car', label: t('order.assistanceOptionCar') },
    { value: 'other', label: t('order.assistanceOptionOther') },
  ] as const;

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <SectionHead icon={<CarIcon />} title={t('order.arrivalAssistanceTitle')} tone="gold" />

      {/* A. Arrival notification */}
      <div className="rounded-2xl border border-line/70 p-4">
        <p className="font-semibold">{t('order.arrivalReadyTitle')}</p>
        <p className="mt-0.5 text-sm text-muted">{t('order.arrivalSupportingText')}</p>
        {isArriving ? (
          <div className="mt-3 flex items-start gap-3 rounded-xl bg-emerald-soft px-3.5 py-3 text-emerald">
            <svg viewBox="0 0 24 24" aria-hidden className="mt-0.5 h-5 w-5 shrink-0">
              <path
                d="m5 12.5 4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold">
                {order.arrivalStatus === 'arrived'
                  ? t('order.arrivalStatusArrived')
                  : t('order.arrivalStatusNotified')}
              </p>
              {order.arrivalNotifiedAt && (
                <p className="text-xs opacity-80">{timeIST(order.arrivalNotifiedAt)}</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <Button
              variant="dark"
              className="mt-3"
              disabled={notifyArrival.isPending}
              onClick={() => notifyArrival.mutate({ status: 'on_the_way' })}
            >
              {notifyArrival.isPending ? t('common.loading') : t('order.arrivalBtn')}
            </Button>
            <ErrorText error={notifyArrival.error} />
          </>
        )}
      </div>

      {/* B. Pickup assistance request */}
      <div className="space-y-3">
        <p className="font-semibold">{t('order.assistanceTitle')}</p>

        {assistance ? (
          <div className="space-y-1.5 rounded-2xl border border-line/70 bg-sand/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('order.assistanceStatusTitle')}
              </span>
              <Badge tone={assistanceTone[assistance]}>{t(assistanceKey[assistance])}</Badge>
            </div>
            <p className="font-semibold">
              {order.assistanceType === 'bring_to_car'
                ? t('order.assistanceOptionCar')
                : t('order.assistanceOptionOther')}
            </p>
            {order.assistanceNotes && <p className="text-sm text-muted">{order.assistanceNotes}</p>}
            {order.assistanceRequestedAt && (
              <p className="text-xs text-muted">{timeIST(order.assistanceRequestedAt)}</p>
            )}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              requestAssistance.mutate({ type: assistanceType, notes: notes.trim() || undefined });
            }}
          >
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {options.map((opt) => {
                const on = assistanceType === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={cx(
                      'flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-sm transition',
                      on
                        ? 'border-plum bg-plum/5 ring-1 ring-plum'
                        : 'border-line bg-white hover:border-plum/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="assistanceType"
                      value={opt.value}
                      checked={on}
                      onChange={() => setAssistanceType(opt.value)}
                      className="mt-0.5 accent-plum"
                    />
                    <span className={cx(on && 'font-semibold')}>{opt.label}</span>
                  </label>
                );
              })}
            </div>

            {assistanceType === 'other' && (
              <Field label={t('order.assistanceNotesLabel')}>
                <Textarea
                  required
                  minLength={3}
                  maxLength={300}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('order.assistanceNotesPlaceholder')}
                />
              </Field>
            )}

            <Button
              type="submit"
              disabled={
                requestAssistance.isPending ||
                (assistanceType === 'other' && notes.trim().length < 3)
              }
            >
              {requestAssistance.isPending ? t('common.loading') : t('order.assistanceSubmitBtn')}
            </Button>
            <ErrorText error={requestAssistance.error} />
          </form>
        )}
      </div>
    </Card>
  );
}

export function OrderPage() {
  const { t } = useTranslation();
  const id = useParams().id ?? '';
  const order = useOrder(id);
  const fee = useStartFee(id);
  const cancel = useCancelOrder(id);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (order.isPending) return <Spinner label={t('common.loading')} />;
  if (!order.data) {
    return (
      <EmptyState
        icon={<Icon icon={ReceiptText} className="h-6 w-6" />}
        title={t('errors.order_not_found')}
        action={<ButtonLink to="/orders">{t('order.back')}</ButtonLink>}
      />
    );
  }
  const o = order.data;
  const shown = o.lines.filter((l) => l.status !== 'replaced' && l.status !== 'removed');
  // Follows the shop's changes (removed items, accepted alternatives) until the bill is final.
  const liveEstimate = o.lines
    .filter((l) => l.status === 'pending' || l.status === 'picked')
    .reduce((n, l) => n + l.unitPricePaise * l.qty, 0);
  const open = o.lines.filter(
    (l) => l.status === 'out_of_stock' || l.status === 'alternate_proposed',
  );
  const closed = ['completed', 'cancelled', 'rejected', 'expired'].includes(o.status);
  const ended = closed && o.status !== 'completed';
  const cancellable = [
    'fee_pending',
    'placed',
    'confirmed',
    'packing',
    'awaiting_customer',
    'packed',
  ].includes(o.status);
  const mapUrl =
    o.shop.lat != null && o.shop.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${o.shop.lat},${o.shop.lng}`
      : null;

  return (
    // One centred column, the same width as My orders. A ready order's pickup QR comes right
    // after the header: it's what the customer needs at the counter.
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/orders" className="inline-block text-sm font-semibold text-plum hover:underline">
        ← {t('order.back')}
      </Link>
      {/* Header card: same anatomy as the My orders card, so the two pages read as one. */}
      <Card className={cx('overflow-hidden p-0', ended && 'opacity-80')}>
        <OrderAccent status={o.status} />
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <ShopBadge name={o.shop.name} className="h-12 w-12 text-xl" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl leading-tight font-extrabold sm:text-3xl">
                {t('order.title', { code: o.code })}
              </h1>
              <p className="mt-0.5 text-muted">{t('order.at', { shop: o.shop.name })}</p>
              {o.placedAt && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink">
                  <CalendarIcon className="h-4 w-4 shrink-0 text-gold-deep" />
                  {t('order.placedOn', { date: when(o.placedAt) })}
                </p>
              )}
            </div>
            <div className="basis-full pl-15 sm:basis-auto sm:pl-0">
              <OrderStatusChip status={o.status} />
            </div>
          </div>
          <OrderTracker status={o.status} />
        </div>
      </Card>
      {o.status !== 'fee_pending' && <NextFee orderId={o.id} />}
      {o.status === 'fee_pending' && (
        <Card className="p-5">
          <p className="font-semibold">{t('order.feeHelp')}</p>
          {o.fee.checkout ? (
            <ButtonLink to={o.fee.checkout.url} size="lg" className="mt-4">
              {t('order.payFee', { fee: formatPaise(o.fee.amountPaise) })}
            </ButtonLink>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">{t('order.feeRetry')}</p>
              <Button
                size="lg"
                className="mt-4"
                disabled={fee.isPending}
                onClick={() => fee.mutate(undefined)}
              >
                {t('order.payFee', { fee: formatPaise(o.fee.amountPaise) })}
              </Button>
            </>
          )}
          <ErrorText error={fee.error} />
        </Card>
      )}
      {o.status === 'placed' && o.confirmBy && (
        <Notice>{t('order.waitingShop', { date: when(o.confirmBy) })}</Notice>
      )}
      {o.status === 'confirmed' && <Notice tone="plum">{t('order.confirmed')}</Notice>}
      {o.status === 'packing' && <Notice tone="plum">{t('order.packing')}</Notice>}
      {o.status === 'awaiting_customer' && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold">{t('order.decisionsTitle')}</h2>
          <p className="text-sm text-muted">{t('order.silence')}</p>
          {open.map((l) => (
            <Decision key={l.id} order={o} line={l} />
          ))}
        </div>
      )}
      {o.status === 'completed' && <Notice tone="emerald">{t('order.completed')}</Notice>}
      {ended && (
        <Notice tone="danger">
          <p className="font-semibold">{t('order.closedTitle')}</p>
          {o.cancelReason && <p className="mt-1">{o.cancelReason}</p>}
        </Notice>
      )}
      {o.status === 'packed' && <PickupQr order={o} />}
      {o.bill && (
        <>
          <BillView bill={o.bill} />
          <Button variant="secondary" className="no-print w-full" onClick={() => window.print()}>
            <Icon icon={Printer} /> {t('order.printBill')}
          </Button>
        </>
      )}
      <Card className="overflow-hidden p-0">
        <div className="p-5 sm:p-6">
          <SectionHead
            icon={<BagIcon />}
            title={t('order.items')}
            aside={
              <span className="text-sm font-semibold text-muted">
                {t('plan.items', { count: shown.length })}
              </span>
            }
          />
          <ul className="mt-3 divide-y divide-line/70">
            {shown.map((l) => (
              <OrderLineRow key={l.id} line={l} />
            ))}
            {o.lines
              .filter((l) => l.status === 'removed')
              .map((l) => (
                <li
                  key={l.id}
                  className="flex justify-between py-2 text-sm text-muted line-through"
                >
                  <span>{itemName(l)}</span>
                  <span>{t('order.lineRemoved')}</span>
                </li>
              ))}
          </ul>
        </div>
        <div className="flex items-end justify-between gap-4 border-t border-line/70 bg-sand/40 px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              {o.finalTotalPaise != null ? t('order.final') : t('order.estimated')}
            </p>
            <p className="font-display text-3xl leading-tight font-semibold text-plum">
              {formatPaise(o.finalTotalPaise ?? liveEstimate)}
            </p>
          </div>
          <Badge tone={o.fee.status === 'paid' ? 'emerald' : 'muted'}>
            {t(`fee.${o.fee.status}`)}
          </Badge>
        </div>
      </Card>
      {o.packPhotoAt && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">{t('packPhoto.title')}</h2>
          <p className="mb-3 text-sm text-muted">{t('packPhoto.customerHelp')}</p>
          <a
            href={`/api/orders/${o.id}/pack-photo?v=${o.packPhotoAt}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={`/api/orders/${o.id}/pack-photo?v=${o.packPhotoAt}`}
              alt={t('packPhoto.alt', { code: o.code })}
              className="max-h-80 w-full rounded-xl border border-line object-contain"
            />
          </a>
        </Card>
      )}
      <Card className="p-5 sm:p-6">
        <SectionHead icon={<PinIcon />} title={t('order.pickupWhere')} />
        <div className="mt-3 pl-12">
          <p className="font-semibold">{o.shop.name}</p>
          {o.shop.address && <p className="text-sm text-muted">{o.shop.address}</p>}
          {o.shop.pickupNotes && (
            <p className="mt-3 rounded-xl bg-sand/60 px-3.5 py-2.5 text-sm">{o.shop.pickupNotes}</p>
          )}
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-plum px-4 text-sm font-semibold text-white transition hover:bg-plum-2"
            >
              {t('order.directions')} <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      </Card>
      {!closed && o.status !== 'fee_pending' && <PickupArrivalAssistanceCard order={o} />}
      {cancellable && (
        <div>
          {confirmCancel ? (
            <Card className="border-danger/30 p-5">
              <p className="font-semibold">{t('order.cancelConfirm')}</p>
              <p className="mt-1 text-sm text-muted">
                {o.packedAt ? t('order.cancelKept') : t('order.cancelRefund')}
              </p>
              <div className="mt-4 flex gap-3">
                <Button
                  variant="danger"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(undefined)}
                >
                  {t('order.cancelYes')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
                  {t('common.keep')}
                </Button>
              </div>
              <ErrorText error={cancel.error} />
            </Card>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="inline-flex min-h-11 items-center rounded-2xl px-4 font-semibold text-danger transition hover:bg-danger-soft"
            >
              {t('order.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** After one shop's fee is paid in a multi-shop checkout, offers the next shop's fee. */
function NextFee({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const feePaise = useFeePaise();
  const navigate = useNavigate();
  const next = peekNext(orderId);
  if (!next) return null;
  const left = payQueue().filter((f) => f.orderId !== orderId).length;
  return (
    <Card className="border-plum/30 bg-brand-050 p-5">
      <p className="text-sm font-semibold text-emerald">{t('cart.paidStep', { left })}</p>
      <p className="mt-1 font-semibold">
        {t('cart.nextFee', { fee: formatPaise(feePaise), shop: next.shopName })}
      </p>
      <Button
        size="lg"
        className="mt-4 w-full sm:w-auto"
        onClick={() => {
          nextAfter(orderId);
          navigate(next.url);
        }}
      >
        {t('cart.payNext')}
      </Button>
    </Card>
  );
}
