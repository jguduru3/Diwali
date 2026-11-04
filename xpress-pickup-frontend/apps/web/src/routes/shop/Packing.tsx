import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ITEM_IMAGE_MAX_BYTES,
  formatPaise,
  type PackSticker,
  type StaffOrder,
  type StaffOrderLine,
} from '@pataka/shared';
import { CallCustomerButton } from '../../components/CallCustomerButton';
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
import { dateTimeIST, itemName } from '../../lib/format';
import { photoToJpegBase64 } from '../../lib/image';
import {
  useFinishPacking,
  useOutOfStock,
  useOwnItems,
  usePackPhoto,
  usePackPhotoUrl,
  usePickByHand,
  useProposeAlternate,
  useScanItem,
  useShopOrder,
  useShopOrders,
  useStartPacking,
} from '../../lib/queries';
import { Camera, Check, Package, Printer } from 'lucide-react';
import { Icon } from '../../components/Icon';

/**
 * Proof of what was packed: the packer photographs the pack with its sticker on.
 * Staff of the shop see it here and at the counter; the customer and admins see
 * it on their order pages.
 */
export function PackPhoto({ order, canUpload }: { order: StaffOrder; canUpload: boolean }) {
  const { t } = useTranslation();
  const upload = usePackPhoto();
  const photoUrl = usePackPhotoUrl();
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    let base64: string;
    try {
      base64 = await photoToJpegBase64(file);
    } catch {
      return setErr(t('packPhoto.badPhoto'));
    }
    if ((base64.length * 3) / 4 > ITEM_IMAGE_MAX_BYTES) return setErr(t('packPhoto.tooBig'));
    upload.mutate({ id: order.id, body: { contentType: 'image/jpeg', base64 } });
  };

  return (
    <div className="space-y-3">
      {order.packPhotoAt ? (
        <a href={photoUrl(order.id, order.packPhotoAt)} target="_blank" rel="noreferrer">
          <img
            src={photoUrl(order.id, order.packPhotoAt)}
            alt={t('packPhoto.alt', { code: order.code })}
            className="max-h-72 w-full rounded-xl border border-line object-contain"
          />
        </a>
      ) : (
        !canUpload && <p className="text-sm text-muted">{t('packPhoto.none')}</p>
      )}
      {order.packPhotoAt && (
        <p className="text-xs text-muted">
          {t('packPhoto.takenAt', { time: dateTimeIST(order.packPhotoAt) })}
        </p>
      )}
      {canUpload && order.status === 'packed' && (
        <label
          className={cx(
            'flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-4 font-semibold',
            upload.isPending && 'pointer-events-none opacity-60',
          )}
        >
          <Icon icon={Camera} /> {order.packPhotoAt ? t('packPhoto.retake') : t('packPhoto.take')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={upload.isPending}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {upload.isPending && <Spinner label={t('packPhoto.uploading')} />}
      {upload.isSuccess && !upload.isPending && (
        <Notice tone="emerald">{t('packPhoto.saved')}</Notice>
      )}
      {err && <Notice tone="danger">{err}</Notice>}
      <ErrorText error={upload.error} />
    </div>
  );
}

/** Step 2 after the sticker: the packed photo, for the open order. */
function PackPhotoStep({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const order = useShopOrder(orderId);
  return (
    <Card className="no-print p-5">
      <h3 className="text-lg font-bold">{t('packPhoto.stepTitle')}</h3>
      <p className="mb-4 text-sm text-muted">{t('packPhoto.stepHelp')}</p>
      {order.data ? <PackPhoto order={order.data} canUpload /> : <ErrorText error={order.error} />}
    </Card>
  );
}

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
      <h3 className="no-print text-lg font-bold">{t('packPhoto.stickerStep')}</h3>
      <Card className="print-area p-6 text-center">
        <p className="text-xs font-bold tracking-[0.2em] text-muted uppercase">
          {t('packing.sticker')}
        </p>
        <p className="font-display text-6xl font-semibold">
          {t('packing.packNo', { n: sticker.packNo })}
        </p>
        <p className="font-mono text-lg">{sticker.code}</p>
        <div className="mt-2 border-y border-line py-2">
          {sticker.customerName && <p className="text-lg font-semibold">{sticker.customerName}</p>}
          <p className="font-mono text-base">{sticker.customerPhone}</p>
        </div>
        <div className="mx-auto mt-3 w-56 [&>div>svg]:h-auto [&>div>svg]:w-full">
          <QrCode text={sticker.qr} label={t('packing.sticker')} />
        </div>
        {/* Typed at the counter if its camera fails. */}
        <p className="mt-1 font-mono text-[10px] break-all text-muted">{sticker.qr}</p>
        <p className="mt-2 text-sm">{t('packing.itemsInPack', { count: sticker.itemCount })}</p>
      </Card>
      <p className="no-print text-center text-sm text-muted">{t('packing.stickerHelp')}</p>
      <Button size="lg" className="no-print w-full" onClick={() => window.print()}>
        <Icon icon={Printer} /> {t('packing.printSticker')}
      </Button>
      <Button variant="ghost" className="no-print w-full" onClick={onReprint}>
        {t('packing.reprint')}
      </Button>
      <PackPhotoStep orderId={sticker.orderId} />
      <Button size="lg" variant="secondary" className="no-print w-full" onClick={onBack}>
        {t('packing.back')}
      </Button>
    </div>
  );
}

/** Out of stock / alternative for one line. Either change goes to the customer to accept. */
function LineActions({ order, line }: { order: StaffOrder; line: StaffOrderLine }) {
  const { t } = useTranslation();
  const items = useOwnItems();
  const oos = useOutOfStock();
  const alt = useProposeAlternate();
  const [proposing, setProposing] = useState(false);
  const [altId, setAltId] = useState('');
  const [altQty, setAltQty] = useState(String(line.qty - line.pickedQty));
  const choices = (items.data?.items ?? []).filter(
    (i) => i.id !== line.itemId && i.isActive && !i.isSoldOut && i.stockQty !== 0,
  );
  return (
    <div className="space-y-3 rounded-2xl border border-saffron/30 bg-saffron-bg/60 p-4">
      <p className="text-sm text-ink">{t('packing.notAvailableHelp')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          disabled={oos.isPending}
          onClick={() => oos.mutate({ id: order.id, body: { lineId: line.id } })}
        >
          {t('packing.outOfStock')}
        </Button>
        <Button variant="secondary" onClick={() => setProposing((v) => !v)}>
          {t('packing.alternate')}
        </Button>
      </div>
      {proposing && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
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
          <Field label={t('packing.altItem')}>
            <Select required value={altId} onChange={(e) => setAltId(e.target.value)}>
              <option value="">—</option>
              {choices.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemName(i)} · {formatPaise(i.effectivePricePaise)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('packing.altQty')}>
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
      <ErrorText error={oos.error ?? alt.error} />
    </div>
  );
}

/** Compact row in the item list under the current step. */
function LineRow({
  line,
  current,
  onPick,
}: {
  line: StaffOrderLine;
  current: boolean;
  onPick?: () => void;
}) {
  const { t } = useTranslation();
  const done = line.status === 'picked';
  const pending = line.status === 'pending';
  return (
    <li
      className={cx(
        'flex items-center gap-3 px-4 py-3',
        current && 'bg-brand-050',
        done && 'text-muted',
      )}
    >
      <span
        className={cx(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold',
          done
            ? 'bg-emerald text-white'
            : pending
              ? 'bg-sand text-ink'
              : 'bg-saffron-bg text-saffron',
        )}
        aria-hidden
      >
        {done ? <Icon icon={Check} /> : line.qty}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('truncate font-semibold', done && 'line-through decoration-1')}>
          {itemName(line)}
        </p>
        <p className="text-xs text-muted">
          {pending || done
            ? t('packing.scanned', { picked: line.pickedQty, qty: line.qty })
            : t(`lineStatus.${line.status}`)}
          {line.rackCode && ` · ${t('packing.rack', { rack: line.rackCode })}`}
        </p>
      </div>
      {pending && !current && onPick && (
        <Button size="sm" variant="ghost" onClick={onPick}>
          {t('packing.goTo')}
        </Button>
      )}
    </li>
  );
}

/**
 * One item at a time: the camera scans this item's barcode; a different barcode is refused
 * here before anything is sent, and the step moves on only once every unit has matched.
 * The server checks each scan again (G11).
 */
function GuidedPick({ order: o }: { order: StaffOrder }) {
  const { t } = useTranslation();
  const scan = useScanItem();
  const pick = usePickByHand();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [matched, setMatched] = useState<string | null>(null);
  const [unavailableOpen, setUnavailableOpen] = useState(false);
  const lines = o.lines.filter((l) => l.status !== 'replaced' && l.status !== 'removed');
  const pending = lines.filter((l) => l.status === 'pending');
  const current = pending.find((l) => l.id === currentId) ?? pending[0] ?? null;
  const done = lines.length - pending.length;
  const step = current ? lines.findIndex((l) => l.id === current.id) + 1 : lines.length;

  // A new item starts clean: no leftover mismatch, scan error or open "not available" panel.
  useEffect(() => {
    setUnavailableOpen(false);
    setMismatch(null);
    scan.reset();
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCode = (code: string) => {
    if (!current) return;
    setMatched(null);
    if (current.barcode && code.trim() !== current.barcode) {
      const other = lines.find((l) => l.barcode === code.trim());
      setMismatch(
        other
          ? t('packing.wrongItem', { name: itemName(other), expected: itemName(current) })
          : t('packing.unknownCode', { code, expected: itemName(current) }),
      );
      navigator.vibrate?.([80, 60, 80]);
      return;
    }
    setMismatch(null);
    scan.mutate(
      { id: o.id, body: { barcode: code.trim(), lineId: current.id } },
      {
        onSuccess: () => {
          setMatched(itemName(current));
          navigator.vibrate?.(40);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex justify-between text-sm font-semibold">
          <span>{t('packing.progress', { done, total: lines.length })}</span>
          {current && (
            <span className="text-muted">
              {t('packing.stepOf', { n: step, total: lines.length })}
            </span>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-sand" aria-hidden>
          <div
            className="h-full rounded-full bg-emerald transition-[width]"
            style={{ width: `${lines.length ? (done / lines.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {current ? (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-4">
            {current.imageUrl ? (
              <img
                src={current.imageUrl}
                alt=""
                className="h-20 w-20 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-brand-050 font-display text-xl font-extrabold text-brand-300">
                #{current.itemNo}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xl leading-tight font-bold">{itemName(current)}</p>
              <p className="mt-1 text-sm text-muted">
                {[
                  current.packDesc,
                  current.rackCode && t('packing.rack', { rack: current.rackCode }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {current.barcode && (
                <p className="mt-1 font-mono text-sm text-muted">
                  {t('packing.expect', { last: current.barcode.slice(-4) })}
                </p>
              )}
            </div>
            <div className="shrink-0 text-center">
              <p className="font-display text-3xl leading-none font-extrabold text-plum tabular-nums">
                {current.pickedQty}/{current.qty}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted">{t('packing.units')}</p>
            </div>
          </div>

          {mismatch && (
            <p
              role="alert"
              className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-semibold text-danger"
            >
              {mismatch}
            </p>
          )}
          {current.barcode ? (
            <>
              <QrScanner
                mode="barcode"
                continuous
                autoFocus
                busy={scan.isPending}
                onResult={onCode}
                manualLabel={t('packing.barcode')}
                manualPlaceholder={t('packing.barcodePlaceholder')}
              />
              <p className="text-sm font-semibold">
                {t('packing.unitsLeft', { count: current.qty - current.pickedQty })}
              </p>
            </>
          ) : (
            <Button
              size="lg"
              variant="success"
              className="w-full"
              disabled={pick.isPending}
              onClick={() => pick.mutate({ id: o.id, body: { lineId: current.id } })}
            >
              <Icon icon={Check} /> {t('packing.pickByHand')}
            </Button>
          )}

          {matched && !scan.error && !mismatch && (
            <p className="text-sm font-semibold text-emerald" role="status">
              <Icon icon={Check} /> {t('packing.matched', { name: matched })}
            </p>
          )}
          <ErrorText error={scan.error ?? pick.error} />

          <div>
            <Button
              variant="ghost"
              onClick={() => setUnavailableOpen((v) => !v)}
              aria-expanded={unavailableOpen}
            >
              {t('packing.notAvailable')}
            </Button>
            {unavailableOpen && (
              <div className="mt-2">
                <LineActions order={o} line={current} />
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Notice tone="emerald">{t('packing.allScanned')}</Notice>
      )}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-line/70">
          {lines.map((l) => (
            <LineRow
              key={l.id}
              line={l}
              current={l.id === current?.id}
              onPick={() => setCurrentId(l.id)}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PackOrder({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useTranslation();
  const order = useShopOrder(id);
  const start = useStartPacking();
  const finish = useFinishPacking();
  const [sticker, setSticker] = useState<PackSticker | null>(null);

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
          <h2 className="font-mono text-2xl font-bold">{o.code}</h2>
          <OrderStatusChip status={o.status} staff />
          <span className="text-sm text-muted">{t('packing.customer', { phone: o.customer })}</span>
          <CallCustomerButton orderId={o.id} canCall={o.canCall} />
        </div>
        {o.status === 'awaiting_customer' && <Notice>{t('packing.waitingCustomer')}</Notice>}
        {o.status === 'packing' || o.status === 'awaiting_customer' ? (
          <GuidedPick order={o} />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {lines.map((l) => (
                <LineRow key={l.id} line={l} current={false} />
              ))}
            </ul>
          </Card>
        )}
      </section>
      <aside className="space-y-4 lg:sticky lg:top-[calc(var(--header-h,8rem)+1rem)] lg:self-start">
        {o.status === 'confirmed' ? (
          <Button
            size="lg"
            className="w-full"
            disabled={start.isPending}
            onClick={() => start.mutate({ id: o.id })}
          >
            {t('packing.start')}
          </Button>
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
        {(o.status === 'packed' || o.packPhotoAt) && (
          <Card className="p-5">
            <h3 className="mb-3 text-lg font-bold">{t('packPhoto.title')}</h3>
            <PackPhoto order={o} canUpload />
          </Card>
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
      <h2 className="text-xl font-bold">{t('packing.queue')}</h2>
      {queue.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={queue.error} />
      {queue.data?.length === 0 && (
        <EmptyState icon={<Icon icon={Package} className="h-6 w-6" />} title={t('packing.empty')} />
      )}
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
