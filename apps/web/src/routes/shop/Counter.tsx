import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  decodePlan,
  formatOrderCode,
  formatPaise,
  parseOrderQr,
  rupeesToPaise,
  staffPhoneMask,
  type PlanPayload,
  type StaffOrder,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import { QrScanner } from '../../components/QrScanner';
import { Badge, Button, Card, Field, Input, Notice, Segmented, cx } from '../../components/ui';
import { itemName, timeIST } from '../../lib/format';
import {
  useCounterCard,
  useCounterCash,
  useCounterOpen,
  useCounterPack,
  useCounterPoll,
  useCounterQr,
  useCounterUpi,
  useCounterUpiSim,
  usePaymentSettings,
  useReviewAssistance,
  useShopAssistanceRequests,
  useShopContext,
} from '../../lib/queries';
import { BillView } from '../customer/OrderPage';
import { PackPhoto } from './Packing';
import { WalkInBill } from './WalkInBill';
import { Bell, Car, Check, Lock, Printer, X } from 'lucide-react';
import { Icon } from '../../components/Icon';

type Method = 'upi' | 'card' | 'cash';

function Payment({
  order,
  onUpdate,
  locked = false,
}: {
  order: StaffOrder;
  onUpdate: (o: StaffOrder) => void;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const settings = usePaymentSettings();
  const [method, setMethod] = useState<Method>('upi');
  const [approval, setApproval] = useState('');
  const [received, setReceived] = useState('');
  const [qrRef, setQrRef] = useState('');

  const upi = useCounterUpi();
  const sim = useCounterUpiSim();
  const qr = useCounterQr();
  const card = useCounterCard();
  const cash = useCounterCash();

  const pending =
    order.counterPayment?.status === 'pending' && order.counterPayment.method === 'upi';
  const poll = useCounterPoll(order.id, pending);
  const live = poll.data ?? order;

  useEffect(() => {
    if (poll.data?.status === 'completed') onUpdate(poll.data);
  }, [poll.data, onUpdate]);

  // Platform credit comes off the bill; the shop collects the rest and is paid the credit later.
  const due = (order.finalTotalPaise ?? 0) - order.creditPaise;
  const receivedPaise = rupeesToPaise(received);
  const done = { onSuccess: onUpdate };
  const payUrl = live.counterPayment?.status === 'pending' ? live.counterPayment.payUrl : null;
  const simulated = payUrl?.startsWith('upi-simulated://');

  // Common quick cash buttons (exact and nearest round numbers)
  const exactRupees = Math.round(due / 100);
  const quickCashOptions = [
    exactRupees,
    exactRupees <= 500 ? 500 : undefined,
    exactRupees <= 1000 ? 1000 : undefined,
    exactRupees <= 2000 ? 2000 : undefined,
  ].filter((v, i, a): v is number => v !== undefined && a.indexOf(v) === i && v >= exactRupees);

  return (
    <Card className="p-6">
      <h3 className="text-lg font-bold">{t('counter.step3', { shop: ctx.data?.name ?? '' })}</h3>
      <p className="mt-2 text-sm text-muted">{t('counter.amountDue')}</p>
      <p className="font-display text-5xl font-semibold text-gold-deep">{formatPaise(due)}</p>

      {locked && (
        <Notice tone="gold" className="mt-4">
          <Icon icon={Lock} /> {t('counter.verifyPackNotice')}
        </Notice>
      )}

      <div className="mt-5">
        <Segmented
          label={t('counter.step3', { shop: '' })}
          value={method}
          onChange={setMethod}
          disabled={locked}
          options={[
            { value: 'upi', label: `${t('counter.phonepeQr')}` },
            { value: 'cash', label: `${t('counter.cash')}` },
            { value: 'card', label: `${t('counter.card')}` },
          ]}
        />
      </div>

      {/* 1. PhonePe QR Payment */}
      {method === 'upi' && (
        <div className="mt-5 space-y-4">
          {settings.data?.qrImageUrl ? (
            <div className="space-y-4">
              {settings.data.qrActive === false && (
                <Notice tone="danger">{t('counter.phonepeDisabled')}</Notice>
              )}
              <div className="mx-auto w-fit rounded-3xl border border-line bg-white p-3 shadow-xs">
                <img
                  src={settings.data.qrImageUrl}
                  alt={t('counter.phonepeQr')}
                  className="h-52 w-52 rounded-2xl object-contain"
                />
              </div>
              <p className="text-center text-sm text-muted">{t('counter.phonepeInstructions')}</p>

              <Field label={t('counter.phonepeRef')}>
                <Input
                  placeholder={t('counter.phonepeRefPlaceholder')}
                  value={qrRef}
                  disabled={locked || qr.isPending}
                  onChange={(e) => setQrRef(e.target.value)}
                />
              </Field>

              <Button
                size="lg"
                className="w-full"
                disabled={locked || qr.isPending || settings.data.qrActive === false}
                onClick={() =>
                  qr.mutate(
                    { id: order.id, body: qrRef.trim() ? { reference: qrRef.trim() } : undefined },
                    done,
                  )
                }
              >
                {qr.isPending
                  ? t('common.loading')
                  : `${t('counter.confirmQrPayment')} · ${formatPaise(due)}`}
              </Button>
              <ErrorText error={qr.error} />
            </div>
          ) : payUrl ? (
            <div className="space-y-3">
              {simulated ? (
                <Notice>{t('counter.upiSimulated')}</Notice>
              ) : (
                <>
                  <div className="mx-auto w-full max-w-[16rem] rounded-3xl bg-white p-3 ring-1 ring-line">
                    <QrCode
                      text={payUrl}
                      label={t('counter.upiHelp')}
                      className="[&>svg]:h-auto [&>svg]:w-full"
                    />
                  </div>
                  <p className="text-center text-sm text-muted">{t('counter.upiHelp')}</p>
                </>
              )}
              <p className="flex items-center justify-center gap-2 text-sm font-semibold">
                <span className="h-3 w-3 animate-pulse rounded-full bg-gold" />{' '}
                {t('counter.upiWaiting')}
              </p>
              {simulated && (
                <Button
                  variant="success"
                  className="w-full"
                  disabled={locked || sim.isPending}
                  onClick={() => sim.mutate({ id: order.id }, done)}
                >
                  {sim.isPending ? t('common.loading') : t('counter.upiSimulate')}
                </Button>
              )}
              <ErrorText error={sim.error} />
            </div>
          ) : (
            <div className="space-y-3">
              <Notice tone="danger">{t('counter.phonepeNoQr')}</Notice>
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={locked || upi.isPending}
                onClick={() => upi.mutate({ id: order.id }, done)}
              >
                {upi.isPending ? t('common.loading') : `${t('counter.upi')} · ${formatPaise(due)}`}
              </Button>
              <ErrorText error={upi.error} />
            </div>
          )}
        </div>
      )}

      {/* 2. Card Payment */}
      {method === 'card' && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (locked) return;
            card.mutate({ id: order.id, body: { approvalCode: approval.trim() } }, done);
          }}
        >
          <Field label={t('counter.approval')}>
            <Input
              required
              pattern="[A-Za-z0-9\-]{4,20}"
              placeholder="e.g. 984521"
              value={approval}
              disabled={locked || card.isPending}
              onChange={(e) => setApproval(e.target.value)}
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={locked || card.isPending || !approval.trim()}
          >
            {card.isPending
              ? t('common.loading')
              : `${t('counter.confirmCardPayment')} · ${formatPaise(due)}`}
          </Button>
          <ErrorText error={card.error} />
        </form>
      )}

      {/* 3. Cash Payment */}
      {method === 'cash' && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (locked) return;
            if (receivedPaise && receivedPaise >= due) {
              cash.mutate({ id: order.id, body: { receivedPaise } }, done);
            }
          }}
        >
          <Field label={t('counter.received')}>
            <Input
              required
              inputMode="decimal"
              placeholder={String(exactRupees)}
              value={received}
              disabled={locked || cash.isPending}
              onChange={(e) => setReceived(e.target.value)}
            />
          </Field>

          {/* Quick Cash Buttons */}
          <div className="flex flex-wrap gap-2">
            {quickCashOptions.map((amt) => (
              <button
                key={amt}
                type="button"
                disabled={locked || cash.isPending}
                className={cx(
                  'rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                  Number(received) === amt
                    ? 'border-gold bg-gold/15 text-gold-deep'
                    : 'border-line bg-surface hover:bg-sand/60',
                )}
                onClick={() => setReceived(String(amt))}
              >
                ₹{amt} {amt === exactRupees && `(${t('counter.exactAmount')})`}
              </button>
            ))}
          </div>

          {receivedPaise != null && receivedPaise >= due && (
            <div className="rounded-xl bg-emerald/10 p-3 text-center">
              <p className="text-xs text-muted">{t('counter.changeToReturn')}</p>
              <p className="text-xl font-bold text-emerald">
                {t('counter.change', { amount: formatPaise(receivedPaise - due) })}
              </p>
            </div>
          )}

          {receivedPaise != null && receivedPaise < due && (
            <p className="text-xs text-danger">
              {t('counter.shortBy', { amount: formatPaise(due - receivedPaise) })}
            </p>
          )}

          <Button
            size="lg"
            className="w-full"
            disabled={locked || cash.isPending || !receivedPaise || receivedPaise < due}
          >
            {cash.isPending
              ? t('common.loading')
              : `${t('counter.confirmCashPayment')} · ${formatPaise(due)}`}
          </Button>
          <ErrorText error={cash.error} />
        </form>
      )}
    </Card>
  );
}

function OrderAtCounter({ initial, onNext }: { initial: StaffOrder; onNext: () => void }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState(initial);
  const pack = useCounterPack();
  const picked = order.lines.filter((l) => l.status === 'picked');
  const totalUnits = picked.reduce((sum, l) => sum + l.pickedQty, 0);

  if (order.status === 'completed' && order.bill) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Notice tone="emerald" className="text-base font-semibold">
          <Icon icon={Check} /> {t('counter.paid', { no: order.bill.billNo })}
        </Notice>
        <BillView bill={order.bill} />
        <div className="no-print grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" onClick={() => window.print()}>
            <Icon icon={Printer} /> {t('counter.printReceipt')}
          </Button>
          <Button size="lg" onClick={onNext}>
            ⌖ {t('counter.next')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: Comprehensive Order Summary */}
      <section className="space-y-4">
        <Card className="overflow-hidden">
          <div className="night-sky px-6 py-5 text-white">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold tracking-[0.2em] text-gold-light uppercase">
                {t('counter.step1')}
              </p>
              <Badge tone="gold" className="text-xs">
                {order.status}
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="font-display text-5xl font-semibold">#{order.packNo}</p>
              <p className="font-mono text-xl font-bold tracking-wider text-gold-light">
                {formatOrderCode(order.code)}
              </p>
            </div>
            <p className="mt-2 text-sm text-white/80">
              {t('counter.customer', { phone: staffPhoneMask(order.customer) })}
            </p>
            {((order.arrivalStatus && order.arrivalStatus !== 'not_arrived') ||
              (order.assistanceStatus && order.assistanceStatus !== 'none')) && (
              <div className="mt-3 border-t border-white/20 pt-2 text-xs text-white/90 space-y-1">
                {order.arrivalStatus && order.arrivalStatus !== 'not_arrived' && (
                  <p>
                    <Icon icon={Car} />{' '}
                    {order.arrivalStatus === 'on_the_way'
                      ? t('counter.customerArrivalOnTheWay')
                      : t('counter.customerArrivalArrived')}
                  </p>
                )}
                {order.assistanceType && (
                  <p>
                    {order.assistanceType === 'bring_to_car'
                      ? `${t('order.assistanceOptionCar')}`
                      : `${t('order.assistanceOptionOther')}`}
                    {order.assistanceNotes && ` · ${order.assistanceNotes}`}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Itemized Table Breakdown */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                <tr>
                  <th className="px-4 py-2.5">{t('counter.orderDetails')}</th>
                  <th className="px-2 py-2.5 text-right">{t('counter.rate')}</th>
                  <th className="px-2 py-2.5 text-center">{t('counter.qty')}</th>
                  <th className="px-4 py-2.5 text-right">{t('counter.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {picked.map((l) => (
                  <tr key={l.id} className="hover:bg-sand/20">
                    <td className="px-4 py-2.5 font-medium text-ink">
                      <div>{itemName(l)}</div>
                      {l.packDesc && <div className="text-xs text-muted">{l.packDesc}</div>}
                    </td>
                    <td className="px-2 py-2.5 text-right text-muted">
                      {formatPaise(l.unitPricePaise)}
                    </td>
                    <td className="px-2 py-2.5 text-center font-semibold">{l.pickedQty}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">
                      {formatPaise(l.unitPricePaise * l.pickedQty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Subtotal & Total Payable Breakdown */}
          <div className="border-t border-line bg-sand/20 px-6 py-4">
            <div className="flex justify-between text-xs text-muted">
              <span>{t('counter.itemCount', { count: totalUnits })}</span>
              <span>{picked.length} items</span>
            </div>
            {order.creditPaise > 0 && (
              <div className="mt-2 flex items-baseline justify-between text-sm">
                <span className="text-muted">{t('counter.creditLine')}</span>
                <span className="font-semibold text-emerald tabular-nums">
                  − {formatPaise(order.creditPaise)}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-baseline justify-between pt-2 border-t border-line/60">
              <span className="text-base font-bold text-ink">{t('counter.totalPayable')}</span>
              <span className="font-display text-2xl font-bold text-gold-deep">
                {formatPaise((order.finalTotalPaise ?? 0) - order.creditPaise)}
              </span>
            </div>
          </div>
        </Card>
      </section>

      {/* Right: Pack Verification & Payment */}
      <section className="space-y-4">
        {/* Top: Pack Sticker Scanner Card */}
        {!order.packMatched ? (
          <Card className="p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t('counter.step2')}</h3>
              <Badge tone="gold">{t('counter.packBadge', { n: order.packNo })}</Badge>
            </div>
            <p className="mb-4 text-sm text-muted">{t('counter.step2Help', { n: order.packNo })}</p>
            <QrScanner
              busy={pack.isPending}
              onResult={(qrCode) =>
                pack.mutate({ id: order.id, body: { qr: qrCode } }, { onSuccess: setOrder })
              }
              manualLabel={t('counter.manual')}
              manualPlaceholder={t('counter.manualPlaceholder')}
            />
            <div className="mt-3">
              <ErrorText error={pack.error} />
            </div>
          </Card>
        ) : (
          <Card className="border-emerald/40 bg-emerald/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald text-base font-bold text-white shadow-xs">
                  <Icon icon={Check} />
                </div>
                <div>
                  <p className="font-semibold text-emerald-deep">
                    {t('counter.packMatched', { n: order.packNo })}
                  </p>
                  <p className="text-xs text-muted">{t('counter.packVerified')}</p>
                </div>
              </div>
              <Badge tone="emerald" className="text-xs font-semibold">
                Verified
              </Badge>
            </div>
          </Card>
        )}

        {order.packPhotoAt && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-bold">{t('packPhoto.title')}</h3>
            <PackPhoto order={order} canUpload={false} />
          </Card>
        )}

        {/* Bottom: Payment Card (ALWAYS visible below scanner) */}
        <Payment order={order} onUpdate={setOrder} locked={!order.packMatched} />

        <Button variant="ghost" className="w-full" onClick={onNext}>
          {t('common.cancel')}
        </Button>
      </section>
    </div>
  );
}

function ArrivalsAndAssistancePanel() {
  const { t } = useTranslation();
  const list = useShopAssistanceRequests();
  const review = useReviewAssistance();
  const items = list.data ?? [];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between pb-3 border-b border-line">
        <h3 className="text-base font-bold text-ink flex items-center gap-2">
          <span>
            <Icon icon={Bell} />
          </span>
          <span>{t('counter.assistanceSectionTitle')}</span>
        </h3>
        <Badge tone={items.length > 0 ? 'plum' : 'muted'}>{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-xs text-muted text-center py-2">{t('counter.noArrivals')}</p>
      ) : (
        <div className="mt-4 divide-y divide-line/60">
          {items.map((item) => (
            <div key={item.id} className="py-3.5 space-y-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-ink">{item.code}</span>
                  {item.packNo && (
                    <Badge tone="gold">{t('counter.packBadge', { n: item.packNo })}</Badge>
                  )}
                  <span className="text-xs text-muted">({item.customer})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {item.arrivalStatus !== 'not_arrived' && (
                    <Badge tone={item.arrivalStatus === 'on_the_way' ? 'plum' : 'emerald'}>
                      {item.arrivalStatus === 'on_the_way'
                        ? `${t('counter.customerArrivalOnTheWay')}`
                        : `${t('counter.customerArrivalArrived')}`}
                    </Badge>
                  )}
                  {item.assistanceStatus !== 'none' && (
                    <Badge
                      tone={
                        item.assistanceStatus === 'approved'
                          ? 'emerald'
                          : item.assistanceStatus === 'rejected'
                            ? 'danger'
                            : 'saffron'
                      }
                    >
                      {t(
                        `order.assistanceStatus${
                          item.assistanceStatus.charAt(0).toUpperCase() +
                          item.assistanceStatus.slice(1)
                        }`,
                      )}
                    </Badge>
                  )}
                </div>
              </div>

              {item.arrivalNotifiedAt && (
                <p className="text-xs text-muted">
                  {t('counter.assistanceRequestedAt', { time: timeIST(item.arrivalNotifiedAt) })}
                </p>
              )}

              {item.assistanceType && (
                <div className="rounded-xl bg-sand/30 p-2.5 text-xs text-ink space-y-1">
                  <p className="font-semibold text-ink">
                    {item.assistanceType === 'bring_to_car'
                      ? `${t('order.assistanceOptionCar')}`
                      : `${t('order.assistanceOptionOther')}`}
                  </p>
                  {item.assistanceNotes && <p className="text-muted">{item.assistanceNotes}</p>}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {item.assistanceStatus === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: item.id, body: { decision: 'approve' } })}
                    >
                      <Icon icon={Check} /> {t('counter.approveAssistance')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: item.id, body: { decision: 'reject' } })}
                    >
                      <Icon icon={X} /> {t('counter.rejectAssistance')}
                    </Button>
                  </>
                )}

                {/* Compliance-Gated Deliver to Car Action: Permanently Disabled */}
                {item.assistanceType === 'bring_to_car' && (
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={true}
                      title={t('counter.carHandoverComplianceNotice')}
                      className="opacity-60 cursor-not-allowed"
                    >
                      <Icon icon={Lock} /> {t('counter.carHandoverAction')}
                    </Button>
                    <span className="text-[10px] text-danger font-medium">
                      {t('counter.carHandoverComplianceNotice')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <ErrorText error={review.error} />
    </Card>
  );
}

/**
 * Express Pickup: customer pickup QR → pack sticker must match → payment to
 * the merchant (PhonePe QR, Card or Cash) → bill → next customer.
 * A walk-in list QR (PP1…) opens the on-device walk-in bill instead.
 */
export function Counter() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const open = useCounterOpen();
  const [order, setOrder] = useState<StaffOrder | null>(null);
  const [walkIn, setWalkIn] = useState<PlanPayload | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const reset = () => {
    setOrder(null);
    setWalkIn(null);
    setScanError(null);
    open.reset();
  };

  const onScan = (text: string) => {
    setScanError(null);
    open.reset();
    if (parseOrderQr(text)) {
      open.mutate({ id: '', body: { qr: text } }, { onSuccess: setOrder });
      return;
    }
    const r = decodePlan(text);
    if (!r.ok) {
      setScanError(t(`counter.decode.${r.error}`, { defaultValue: t('counter.badQr') }));
      return;
    }
    if (ctx.data && r.value.shopCode !== ctx.data.shopCode) {
      setScanError(t('counter.otherShop', { code: r.value.shopCode }));
      return;
    }
    setWalkIn(r.value);
  };

  if (order) return <OrderAtCounter key={order.id} initial={order} onNext={reset} />;
  if (walkIn) return <WalkInBill plan={walkIn} onDone={reset} />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ArrivalsAndAssistancePanel />

      <Card className="p-6">
        <h2 className="text-2xl font-bold">{t('counter.title')}</h2>
        <p className="mt-1 mb-5 text-muted">{t('counter.subtitle')}</p>
        <QrScanner
          busy={open.isPending}
          onResult={onScan}
          manualLabel={t('counter.manual')}
          manualPlaceholder={t('counter.manualPlaceholder')}
        />
      </Card>
      {scanError && <Notice tone="danger">{scanError}</Notice>}
      <ErrorText error={open.error} />
      <p className={cx('text-center text-xs text-muted')}>{t('counter.privacy')}</p>
    </div>
  );
}
