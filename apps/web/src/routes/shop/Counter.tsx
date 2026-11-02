import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  decodePlan,
  formatGrams,
  formatPaise,
  lineAmount,
  parseOrderQr,
  rupeesToPaise,
  type PlanPayload,
  type StaffOrder,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import { QrScanner } from '../../components/QrScanner';
import { Badge, Button, Card, Field, Input, Notice, Segmented, cx } from '../../components/ui';
import { itemName } from '../../lib/format';
import {
  useCounterCard,
  useCounterCash,
  useCounterOpen,
  useCounterPack,
  useCounterPoll,
  useCounterUpi,
  useCounterUpiSim,
  useShopContext,
} from '../../lib/queries';
import { BillView } from '../customer/OrderPage';
import { WalkInBill } from './WalkInBill';

type Method = 'upi' | 'card' | 'cash';

function Payment({ order, onUpdate }: { order: StaffOrder; onUpdate: (o: StaffOrder) => void }) {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const [method, setMethod] = useState<Method>('upi');
  const [approval, setApproval] = useState('');
  const [received, setReceived] = useState('');
  const upi = useCounterUpi();
  const sim = useCounterUpiSim();
  const card = useCounterCard();
  const cash = useCounterCash();
  const pending =
    order.counterPayment?.status === 'pending' && order.counterPayment.method === 'upi';
  const poll = useCounterPoll(order.id, pending);
  const live = poll.data ?? order;
  useEffect(() => {
    if (poll.data?.status === 'completed') onUpdate(poll.data);
  }, [poll.data, onUpdate]);
  const due = order.finalTotalPaise ?? 0;
  const receivedPaise = rupeesToPaise(received);
  const done = { onSuccess: onUpdate };
  const payUrl = live.counterPayment?.status === 'pending' ? live.counterPayment.payUrl : null;
  const simulated = payUrl?.startsWith('upi-simulated://');

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold">
        {t('counter.step3', { shop: ctx.data?.name ?? '' })}
      </h3>
      <p className="mt-2 text-sm text-muted">{t('counter.amountDue')}</p>
      <p className="font-display text-5xl font-semibold">{formatPaise(due)}</p>
      <div className="mt-5">
        <Segmented
          label={t('counter.step3', { shop: '' })}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'upi', label: t('counter.upi') },
            { value: 'card', label: t('counter.card') },
            { value: 'cash', label: t('counter.cash') },
          ]}
        />
      </div>

      {method === 'upi' && (
        <div className="mt-5 space-y-3">
          {payUrl ? (
            <>
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
                  disabled={sim.isPending}
                  onClick={() => sim.mutate({ id: order.id }, done)}
                >
                  {t('counter.upiSimulate')}
                </Button>
              )}
            </>
          ) : (
            <Button
              size="lg"
              className="w-full"
              disabled={upi.isPending}
              onClick={() => upi.mutate({ id: order.id }, done)}
            >
              {t('counter.upi')} · {formatPaise(due)}
            </Button>
          )}
          <ErrorText error={upi.error ?? sim.error} />
        </div>
      )}

      {method === 'card' && (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            card.mutate({ id: order.id, body: { approvalCode: approval.trim() } }, done);
          }}
        >
          <Field label={t('counter.approval')}>
            <Input
              required
              pattern="[A-Za-z0-9\-]{4,20}"
              value={approval}
              onChange={(e) => setApproval(e.target.value)}
            />
          </Field>
          <Button size="lg" className="w-full" disabled={card.isPending}>
            {t('counter.recordCard')}
          </Button>
          <ErrorText error={card.error} />
        </form>
      )}

      {method === 'cash' && (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (receivedPaise) cash.mutate({ id: order.id, body: { receivedPaise } }, done);
          }}
        >
          <Field label={t('counter.received')}>
            <Input
              required
              inputMode="decimal"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
            />
          </Field>
          {receivedPaise != null && receivedPaise >= due && (
            <p className="text-lg font-semibold text-emerald">
              {t('counter.change', { amount: formatPaise(receivedPaise - due) })}
            </p>
          )}
          <Button size="lg" className="w-full" disabled={cash.isPending || !receivedPaise}>
            {t('counter.recordCash')}
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

  if (order.status === 'completed' && order.bill) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Notice tone="emerald" className="text-base font-semibold">
          ✓ {t('counter.paid', { no: order.bill.billNo })}
        </Notice>
        <BillView bill={order.bill} />
        <div className="no-print grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" onClick={() => window.print()}>
            🖨 {t('counter.print')}
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
      <section className="space-y-4">
        <Card className="overflow-hidden">
          <div className="night-sky px-6 py-5 text-white">
            <p className="text-xs font-bold tracking-[0.2em] text-gold-light uppercase">
              {t('counter.step1')}
            </p>
            <p className="mt-1 font-display text-6xl font-semibold">#{order.packNo}</p>
            <p className="mt-1 text-white/80">
              {order.code} · {t('counter.customer', { phone: order.customer })}
            </p>
          </div>
          <ul className="divide-y divide-line/70 px-6 py-2">
            {picked.map((l) => (
              <li key={l.id} className="flex justify-between py-2 text-sm">
                <span>
                  <span className="font-semibold">
                    {l.packedGrams != null ? formatGrams(l.packedGrams) : `${l.pickedQty}×`}
                  </span>{' '}
                  {itemName(l)}
                </span>
                <span>
                  {formatPaise(
                    lineAmount(
                      l.unitPricePaise,
                      l.packedGrams != null ? { grams: l.packedGrams } : { qty: l.pickedQty },
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
      <section className="space-y-4">
        {!order.packMatched ? (
          <Card className="p-6">
            <h3 className="text-lg font-semibold">{t('counter.step2')}</h3>
            <p className="mb-4 text-sm text-muted">{t('counter.step2Help', { n: order.packNo })}</p>
            <QrScanner
              busy={pack.isPending}
              onResult={(qr) =>
                pack.mutate({ id: order.id, body: { qr } }, { onSuccess: setOrder })
              }
              manualLabel={t('counter.manual')}
              manualPlaceholder={t('counter.manualPlaceholder')}
            />
            <div className="mt-3">
              <ErrorText error={pack.error} />
            </div>
          </Card>
        ) : (
          <>
            <Badge tone="emerald" className="text-sm">
              ✓ {t('counter.packMatched', { n: order.packNo })}
            </Badge>
            <Payment order={order} onUpdate={setOrder} />
          </>
        )}
        <Button variant="ghost" className="w-full" onClick={onNext}>
          {t('common.cancel')}
        </Button>
      </section>
    </div>
  );
}

/**
 * Express Pickup: customer pickup QR → pack sticker must match → payment to
 * the merchant (UPI via their YouPI-PG, card or cash) → bill → next customer.
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
      <Card className="p-6">
        <h2 className="text-2xl font-semibold">{t('counter.title')}</h2>
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
