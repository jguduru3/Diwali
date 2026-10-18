import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise, type Bill, type CustomerOrder, type OrderLine } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { QrCode } from '../../components/QrCode';
import { SafetyNotice } from '../../components/SafetyNotice';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  Spinner,
  cx,
} from '../../components/ui';
import { dayIST, itemName, timeIST } from '../../lib/format';
import { loadPickupQr } from '../../lib/orderStore';
import { useCancelOrder, useDecision, useOrder, usePickupQr, useStartFee } from '../../lib/queries';

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
              <td className="py-2 pr-2">{l.nameEn}</td>
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
      <div className="night-sky px-6 pt-6 pb-8 text-white">
        <p className="text-xs font-bold tracking-[0.2em] text-gold-light uppercase">
          {t('order.readyTitle')}
        </p>
        <p className="mt-2 font-display text-5xl font-semibold">
          {t('order.packNo', { n: order.packNo })}
        </p>
        <p className="mt-1 text-white/80">{order.shop.name}</p>
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
        icon="🧾"
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
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_1fr]">
      <section className="space-y-5">
        <div>
          <Link to="/orders" className="text-sm font-semibold text-plum hover:underline">
            ← {t('order.back')}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">{t('order.title', { code: o.code })}</h1>
            <OrderStatusChip status={o.status} />
          </div>
          <p className="text-muted">{t('order.at', { shop: o.shop.name })}</p>
        </div>

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
            <h2 className="text-xl font-semibold">{t('order.decisionsTitle')}</h2>
            <p className="text-sm text-muted">{t('order.silence')}</p>
            {open.map((l) => (
              <Decision key={l.id} order={o} line={l} />
            ))}
          </div>
        )}
        {o.status === 'completed' && <Notice tone="emerald">{t('order.completed')}</Notice>}
        {closed && o.status !== 'completed' && (
          <Notice tone="danger">
            <p className="font-semibold">{t('order.closedTitle')}</p>
            {o.cancelReason && <p className="mt-1">{o.cancelReason}</p>}
          </Notice>
        )}

        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">{t('order.items')}</h2>
          <ul className="divide-y divide-line/70">
            {shown.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                {l.imageUrl ? (
                  <img src={l.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-sand font-semibold text-gold-deep">
                    #{l.itemNo}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{itemName(l)}</p>
                  <p className="text-sm text-muted">
                    {l.qty} × {formatPaise(l.unitPricePaise)} {l.packDesc && `· ${l.packDesc}`}
                  </p>
                </div>
                <Badge
                  tone={
                    l.status === 'picked' ? 'emerald' : l.status === 'pending' ? 'muted' : 'saffron'
                  }
                >
                  {t(`lineStatus.${l.status}`)}
                </Badge>
              </li>
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
          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-muted">
              {o.finalTotalPaise != null ? t('order.final') : t('order.estimated')}
            </span>
            <span className="font-display text-2xl font-semibold">
              {formatPaise(o.finalTotalPaise ?? liveEstimate)}
            </span>
          </div>
          <p className="mt-2 text-right text-xs text-muted">{t(`fee.${o.fee.status}`)}</p>
        </Card>

        <Card className="p-5 text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t('order.pickupWhere')}
          </p>
          <p className="font-semibold">{o.shop.name}</p>
          {o.shop.address && <p className="text-muted">{o.shop.address}</p>}
          {o.shop.pickupNotes && <p className="mt-2">{o.shop.pickupNotes}</p>}
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-semibold text-plum underline-offset-4 hover:underline"
            >
              {t('order.directions')} ↗
            </a>
          )}
        </Card>

        {cancellable && (
          <div>
            {confirmCancel ? (
              <Card className="p-5">
                <p className="font-semibold">{t('order.cancelConfirm')}</p>
                <p className="mt-1 text-sm text-muted">
                  {o.confirmedAt ? t('order.cancelKept') : t('order.cancelRefund')}
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
              <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                {t('order.cancel')}
              </Button>
            )}
          </div>
        )}
      </section>

      <aside className={cx('space-y-4 lg:sticky lg:top-40 lg:self-start')}>
        {o.status === 'packed' && <PickupQr order={o} />}
        {o.bill && (
          <>
            <BillView bill={o.bill} />
            <Button variant="secondary" className="no-print w-full" onClick={() => window.print()}>
              🖨 {t('order.printBill')}
            </Button>
          </>
        )}
        {o.status !== 'packed' && !o.bill && <SafetyNotice />}
      </aside>
    </div>
  );
}
