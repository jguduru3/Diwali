import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { encodePlan, formatPaise, type Visit } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import { Badge, Button, ButtonLink, EmptyState, Notice, Spinner } from '../../components/ui';
import { dayIST, slotRange } from '../../lib/format';
import { getPlan } from '../../lib/planList';
import { useCancelVisit, useCurrentVisit, useShopItems } from '../../lib/queries';
import { loadTicket } from '../../lib/ticketStore';
import { usePlanDetails } from './usePlanDetails';

/** G8: every ticket carries the safety notice. Exported for the snapshot test. */
export function SafetyNotice() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="safety-notice"
      className="flex gap-3 rounded-2xl border border-saffron/30 bg-saffron/8 p-4 text-sm text-ink"
    >
      <span aria-hidden className="text-xl">
        🪔
      </span>
      <p className="font-semibold">{t('safety.notice')}</p>
    </div>
  );
}

export function Ticket({ visit, offline = false }: { visit: Visit; offline?: boolean }) {
  const { t } = useTranslation();
  const code = visit.shop.shortCode;
  const stored = getPlan(code);
  const items = useShopItems(code);
  const { total } = usePlanDetails(stored?.lines ?? [], items.data);
  const priceVersion = stored?.priceVersion ?? items.data?.priceVersion ?? 1;
  const payload = encodePlan({
    visitCode: visit.code,
    shopCode: code,
    priceVersion,
    lines: stored?.lines ?? [],
  });
  const cancel = useCancelVisit();
  const [confirm, setConfirm] = useState(false);
  const [showText, setShowText] = useState(false);
  const place = visit.cluster ?? visit.shop;
  const mapUrl =
    place.lat != null && place.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
      : null;
  const count = stored?.lines.reduce((n, l) => n + l.qty, 0) ?? 0;

  return (
    <article className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-[2rem] bg-white shadow-[var(--shadow-lift)] ring-1 ring-line">
        <div className="night-sky px-6 pt-6 pb-10 text-white">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold tracking-[0.2em] text-gold-light uppercase">
              {t('ticket.eyebrow')}
            </p>
            <Badge
              tone={visit.status === 'arrived' ? 'emerald' : 'gold'}
              className={
                visit.status === 'arrived'
                  ? 'bg-emerald/30 text-white ring-emerald/60'
                  : 'bg-gold/20 text-gold-light ring-gold/40'
              }
            >
              {t(`status.${visit.status}`)}
              {visit.bayNo ? ` · ${t('ticket.bay', { n: visit.bayNo })}` : ''}
            </Badge>
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-white">{visit.shop.name}</h1>
          <p className="mt-1 text-lg text-white/85">
            {dayIST(visit.slot.startsAt)} · {slotRange(visit.slot.startsAt, visit.slot.endsAt)}
          </p>
        </div>

        <div className="relative -mt-6 rounded-t-[2rem] bg-white px-6 pt-6 pb-6">
          <div className="mx-auto w-full max-w-[18rem] rounded-3xl bg-white p-3 ring-1 ring-line">
            <QrCode
              text={payload}
              label={t('ticket.qrLabel', { code: visit.code })}
              className="[&>svg]:h-auto [&>svg]:w-full"
            />
          </div>
          <p className="mt-3 text-center font-mono text-3xl font-bold tracking-[0.35em] text-plum">
            {visit.code}
          </p>
          <p className="text-center text-xs text-muted">{t('ticket.showQr')}</p>

          <div className="my-6 border-t-2 border-dashed border-line" />

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('ticket.list')}
              </dt>
              <dd className="font-semibold">
                {count ? t('plan.summary', { count, total: formatPaise(total) }) : t('book.noList')}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('book.vehicle')}
              </dt>
              <dd className="font-semibold">
                {visit.vehicle ? t(`vehicle.${visit.vehicle}`) : '—'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('ticket.where')}
              </dt>
              <dd className="font-semibold">{visit.cluster?.name ?? visit.shop.name}</dd>
              <dd className="text-muted">{visit.cluster?.address ?? visit.shop.address}</dd>
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-semibold text-plum underline-offset-4 hover:underline"
                >
                  {t('ticket.directions')} ↗
                </a>
              )}
            </div>
          </dl>

          <div className="mt-5 space-y-3">
            <Notice tone="plum">
              <p className="font-semibold">{t('ticket.bayTitle')}</p>
              <p className="mt-1">{visit.cluster?.gateNotes ?? t('ticket.bayDefault')}</p>
            </Notice>
            <p className="text-center text-xs font-semibold text-muted">{t('ticket.payAtShop')}</p>
            <SafetyNotice />
          </div>
        </div>
      </div>

      {offline && <Notice className="mt-4">{t('ticket.offline')}</Notice>}

      <div className="mt-5 space-y-3 text-center">
        <Button variant="ghost" size="sm" onClick={() => setShowText((v) => !v)}>
          {showText ? t('ticket.hideText') : t('ticket.showText')}
        </Button>
        {showText && (
          <p className="rounded-2xl bg-sand px-4 py-3 font-mono text-xs break-all select-all">
            {payload}
          </p>
        )}

        {visit.status === 'booked' && !offline && (
          <div>
            <ErrorText error={cancel.error} />
            {confirm ? (
              <div className="flex justify-center gap-3">
                <Button
                  variant="danger"
                  onClick={() => cancel.mutate(visit.code)}
                  disabled={cancel.isPending}
                >
                  {t('ticket.cancelYes')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirm(false)}>
                  {t('common.keep')}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirm(true)}>
                {t('ticket.cancel')}
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** SPEC §9 screen 6. Falls back to the copy saved on the phone when offline. */
export function TicketPage() {
  const { t } = useTranslation();
  const current = useCurrentVisit(true);
  if (current.isPending) return <Spinner label={t('common.loading')} />;
  const offline = current.isError;
  const visit = current.data ?? (offline ? loadTicket() : null);
  if (!visit) {
    return (
      <>
        {current.isError && <ErrorText error={current.error} />}
        <EmptyState
          icon="🎟"
          title={t('ticket.noneTitle')}
          body={t('ticket.noneBody')}
          action={<ButtonLink to="/">{t('home.cta')}</ButtonLink>}
        />
      </>
    );
  }
  return <Ticket visit={visit} offline={offline} />;
}
