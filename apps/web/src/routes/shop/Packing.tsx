import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPaise,
  type PackSticker,
  type StaffOrder,
  type StaffOrderLine,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { QrCode } from '../../components/QrCode';
import { QrScanner } from '../../components/QrScanner';
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
  cx,
} from '../../components/ui';
import { itemName } from '../../lib/format';
import {
  useFinishPacking,
  useOutOfStock,
  useOwnItems,
  usePickByHand,
  useProposeAlternate,
  useScanItem,
  useShopOrder,
  useShopOrders,
  useStartPacking,
} from '../../lib/queries';

/** Printed and stuck on the pack; the cashier scans it at Express Pickup. */
function Sticker({
  sticker,
  onReprint,
  onBack,
}: {
  sticker: PackSticker;
  onReprint: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card className="print-area p-6 text-center">
        <p className="text-xs font-bold tracking-[0.2em] text-muted uppercase">
          {t('packing.sticker')}
        </p>
        <p className="font-display text-6xl font-semibold">
          {t('packing.packNo', { n: sticker.packNo })}
        </p>
        <p className="font-mono text-lg">{sticker.code}</p>
        <div className="mx-auto mt-3 w-56 [&>div>svg]:h-auto [&>div>svg]:w-full">
          <QrCode text={sticker.qr} label={t('packing.sticker')} />
        </div>
        {/* Typed at the counter if its camera fails. */}
        <p className="mt-1 font-mono text-[10px] break-all text-muted">{sticker.qr}</p>
        <p className="mt-2 text-sm">{t('packing.itemsInPack', { count: sticker.itemCount })}</p>
      </Card>
      <p className="no-print text-center text-sm text-muted">{t('packing.stickerHelp')}</p>
      <div className="no-print grid gap-3 sm:grid-cols-2">
        <Button size="lg" onClick={() => window.print()}>
          🖨 {t('packing.printSticker')}
        </Button>
        <Button size="lg" variant="secondary" onClick={onBack}>
          {t('packing.back')}
        </Button>
      </div>
      <Button variant="ghost" className="no-print w-full" onClick={onReprint}>
        {t('packing.reprint')}
      </Button>
    </div>
  );
}

function LineRow({ order, line }: { order: StaffOrder; line: StaffOrderLine }) {
  const { t } = useTranslation();
  const items = useOwnItems();
  const pick = usePickByHand();
  const oos = useOutOfStock();
  const alt = useProposeAlternate();
  const [proposing, setProposing] = useState(false);
  const [altId, setAltId] = useState('');
  const [altQty, setAltQty] = useState(String(line.qty - line.pickedQty));
  const canAct = order.status === 'packing' && line.status === 'pending';
  const choices = (items.data?.items ?? []).filter(
    (i) => i.id !== line.itemId && i.isActive && !i.isSoldOut && i.stockQty !== 0,
  );
  return (
    <li className={cx('px-5 py-4', line.status === 'picked' && 'bg-emerald-soft/40')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-3xl font-semibold text-plum">{line.qty}×</span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{itemName(line)}</p>
          <p className="text-sm text-muted">
            #{line.itemNo} {line.packDesc && `· ${line.packDesc}`}
            {line.rackCode && ` · ${t('packing.rack', { rack: line.rackCode })}`}
            {line.barcode && ` · ▥ ${line.barcode}`}
          </p>
        </div>
        <Badge
          tone={
            line.status === 'picked' ? 'emerald' : line.status === 'pending' ? 'muted' : 'saffron'
          }
        >
          {line.status === 'pending' || line.status === 'picked'
            ? t('packing.scanned', { picked: line.pickedQty, qty: line.qty })
            : t(`lineStatus.${line.status}`)}
        </Badge>
      </div>
      {canAct && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!line.barcode && (
            <Button
              size="sm"
              variant="success"
              disabled={pick.isPending}
              onClick={() => pick.mutate({ id: order.id, body: { lineId: line.id } })}
            >
              ✓ {t('packing.pickByHand')}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={oos.isPending}
            onClick={() => oos.mutate({ id: order.id, body: { lineId: line.id } })}
          >
            {t('packing.outOfStock')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setProposing((v) => !v)}>
            {t('packing.alternate')}
          </Button>
        </div>
      )}
      {canAct && proposing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            alt.mutate(
              {
                id: order.id,
                body: { lineId: line.id, itemId: altId, qty: Math.max(1, Number(altQty) || 1) },
              },
              { onSuccess: () => setProposing(false) },
            );
          }}
        >
          <Field label={t('packing.altItem')} className="min-w-56 flex-1">
            <Select required value={altId} onChange={(e) => setAltId(e.target.value)}>
              <option value="">—</option>
              {choices.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemName(i)} · {formatPaise(i.effectivePricePaise)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('packing.altQty')} className="w-24">
            <Input
              type="number"
              min={1}
              max={99}
              value={altQty}
              onChange={(e) => setAltQty(e.target.value)}
            />
          </Field>
          <Button disabled={alt.isPending || !altId}>{t('packing.sendAlt')}</Button>
        </form>
      )}
      <ErrorText error={pick.error ?? oos.error ?? alt.error} />
    </li>
  );
}

function PackOrder({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useTranslation();
  const order = useShopOrder(id);
  const start = useStartPacking();
  const scan = useScanItem();
  const finish = useFinishPacking();
  const [sticker, setSticker] = useState<PackSticker | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const status = order.data?.status;
  // A scan error belongs to that scan: clear it once the order moves on.
  useEffect(() => scan.reset(), [status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sticker) {
    return (
      <Sticker
        sticker={sticker}
        onBack={onBack}
        onReprint={() => finish.mutate({ id, reprint: true }, { onSuccess: setSticker })}
      />
    );
  }
  if (order.isPending) return <Spinner label={t('common.loading')} />;
  if (!order.data) return <ErrorText error={order.error} />;
  const o = order.data;
  const lines = o.lines.filter((l) => l.status !== 'replaced' && l.status !== 'removed');
  const ready =
    o.status === 'packing' &&
    o.lines.every((l) => ['picked', 'removed', 'replaced'].includes(l.status)) &&
    o.lines.some((l) => l.status === 'picked');

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← {t('packing.back')}
          </Button>
          <h2 className="font-mono text-2xl font-semibold">{o.code}</h2>
          <OrderStatusChip status={o.status} staff />
          <span className="text-sm text-muted">{t('packing.customer', { phone: o.customer })}</span>
        </div>
        {o.status === 'awaiting_customer' && <Notice>{t('packing.waitingCustomer')}</Notice>}
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line/70">
            {lines.map((l) => (
              <LineRow key={l.id} order={o} line={l} />
            ))}
          </ul>
        </Card>
      </section>
      <aside className="space-y-4 lg:sticky lg:top-40 lg:self-start">
        {o.status === 'confirmed' ? (
          <Button
            size="lg"
            className="w-full"
            disabled={start.isPending}
            onClick={() => start.mutate({ id: o.id })}
          >
            {t('packing.start')}
          </Button>
        ) : o.status === 'packing' || o.status === 'awaiting_customer' ? (
          <Card className="p-5">
            <h3 className="text-lg font-semibold">{t('packing.scanTitle')}</h3>
            <p className="mb-4 text-sm text-muted">{t('packing.scanHelp')}</p>
            <QrScanner
              mode="barcode"
              continuous
              autoFocus
              busy={scan.isPending}
              onResult={(barcode) =>
                scan.mutate(
                  { id: o.id, body: { barcode } },
                  {
                    onSuccess: (next) => {
                      const hit = next.lines.find((l) => l.barcode === barcode);
                      setLastScan(hit ? itemName(hit) : barcode);
                    },
                  },
                )
              }
              manualLabel={t('packing.barcode')}
              manualPlaceholder={t('packing.barcodePlaceholder')}
            />
            {lastScan && !scan.error && (
              <p className="mt-3 text-sm font-semibold text-emerald">
                ✓ {t('packing.lastScan', { name: lastScan })}
              </p>
            )}
            <div className="mt-3">
              <ErrorText error={scan.error} />
            </div>
          </Card>
        ) : null}
        {(o.status === 'packing' || o.status === 'awaiting_customer') && (
          <Card className="p-5">
            <Button
              size="lg"
              variant="success"
              className="w-full"
              disabled={!ready || finish.isPending}
              onClick={() => finish.mutate({ id: o.id }, { onSuccess: setSticker })}
            >
              {t('packing.finish')}
            </Button>
            {!ready && <p className="mt-2 text-xs text-muted">{t('packing.finishHelp')}</p>}
            <ErrorText error={finish.error} />
          </Card>
        )}
        {o.status === 'packed' && (
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            onClick={() => finish.mutate({ id: o.id, reprint: true }, { onSuccess: setSticker })}
          >
            {t('packing.reprint')}
          </Button>
        )}
      </aside>
    </div>
  );
}

/** Packer portal: confirmed orders → scan every unit → resolve exceptions → pack → sticker. */
export function Packing() {
  const { t } = useTranslation();
  const queue = useShopOrders('packing');
  const [open, setOpen] = useState<string | null>(null);

  if (open) return <PackOrder id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t('packing.queue')}</h2>
      {queue.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={queue.error} />
      {queue.data?.length === 0 && <EmptyState icon="📦" title={t('packing.empty')} />}
      <ul className="space-y-3">
        {queue.data?.map((o) => (
          <Card as="li" key={o.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                <span className="font-mono">{o.code}</span> · {o.customer}
              </p>
              <p className="text-sm text-muted">{t('shopOrders.items', { count: o.lineCount })}</p>
            </div>
            {o.openDecisions > 0 && (
              <Badge tone="saffron">
                {t('shopOrders.openDecisions', { count: o.openDecisions })}
              </Badge>
            )}
            <OrderStatusChip status={o.status} staff />
            <Button size="sm" onClick={() => setOpen(o.id)}>
              {t('packing.open')}
            </Button>
          </Card>
        ))}
      </ul>
    </div>
  );
}
