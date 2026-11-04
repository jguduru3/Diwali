import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFeePaise } from '../../lib/settings';
import { encodePlan, formatPaise } from '@pataka/shared';
import { useMe } from '../../auth/useAuth';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import { SafetyNotice } from '../../components/SafetyNotice';
import { QtyStepper } from '../../components/QtyStepper';
import { Badge, Button, ButtonLink, Card, EmptyState, Notice, Spinner } from '../../components/ui';
import { itemName } from '../../lib/format';
import { usePlan } from '../../lib/planList';
import { useOrderingInfo, usePlaceOrder, useShop, useShopItems } from '../../lib/queries';
import { usePlanDetails } from './usePlanDetails';
import { ListChecks } from 'lucide-react';
import { Icon } from '../../components/Icon';

/**
 * Review the order. Placing it sends item ids and quantities only — the server
 * prices it (G11) — then opens the ₹30 platform-fee payment.
 */
export function PlanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const code = (useParams().code ?? '').toUpperCase();
  const shop = useShop(code);
  const items = useShopItems(code);
  const plan = usePlan(code, items.data?.priceVersion);
  const { rows, total, unavailable } = usePlanDetails(plan.lines, items.data);
  const [walkIn, setWalkIn] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  // On a phone the QR opens below the fold: bring it into view so it can be shown at once.
  useEffect(() => {
    if (walkIn) qrRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [walkIn]);
  const { data: me } = useMe();
  const ordering = useOrderingInfo();
  const feePaise = useFeePaise();
  const place = usePlaceOrder();
  const fee = formatPaise(feePaise);
  // Phone action bar: shown only while the main Place order button is off-screen.
  const placeRef = useRef<HTMLDivElement>(null);
  const [placeInView, setPlaceInView] = useState(true);
  useEffect(() => {
    const el = placeRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPlaceInView(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [me, ordering.data?.enabled, plan.lines.length]);

  const placeOrder = () => {
    const lines = rows.filter((r) => r.item).map((r) => ({ itemId: r.item!.id, qty: r.qty }));
    place.mutate(
      { shopCode: code, lines },
      {
        onSuccess: (order) => {
          plan.clear();
          if (order.fee.checkout) navigate(order.fee.checkout.url);
          else navigate(`/orders/${order.id}`);
        },
      },
    );
  };

  if (items.isPending) return <Spinner label={t('common.loading')} />;
  if (!plan.lines.length) {
    return (
      <EmptyState
        icon={<Icon icon={ListChecks} className="h-6 w-6" />}
        title={t('plan.emptyTitle')}
        body={t('plan.emptyBody')}
        action={<ButtonLink to={`/s/${code}`}>{t('plan.browse')}</ButtonLink>}
      />
    );
  }
  const priceVersion = items.data?.priceVersion ?? plan.plan?.priceVersion ?? 1;
  const changed = plan.plan && items.data && plan.plan.priceVersion !== items.data.priceVersion;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <Link to={`/s/${code}`} className="text-sm font-semibold text-plum hover:underline">
          ← {shop.data?.name ?? code}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{t('plan.title')}</h1>
        <p className="mt-1 text-muted">{t('plan.onPhone')}</p>
        {changed && <Notice className="mt-4">{t('plan.pricesChanged')}</Notice>}

        <ul className="mt-5 space-y-3">
          {rows.map((r) => (
            <Card
              as="li"
              key={r.itemNo}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:flex-nowrap"
            >
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <p className="font-semibold">
                  {r.item ? itemName(r.item) : t('plan.unknownItem', { no: r.itemNo })}
                </p>
                <p className="text-sm text-muted">
                  {r.item &&
                    `${r.item.packDesc ?? ''} · ${formatPaise(r.item.effectivePricePaise)}`}
                </p>
                {r.item?.isSoldOut && (
                  <Badge tone="danger" className="mt-1">
                    {t('shopPage.soldOut')}
                  </Badge>
                )}
              </div>
              <QtyStepper
                qty={r.qty}
                name={r.item ? itemName(r.item) : `#${r.itemNo}`}
                onChange={(n) => plan.setQty(r.itemNo, n)}
              />
              <p className="ml-auto w-20 text-right font-display text-lg font-semibold sm:ml-0">
                {formatPaise(r.lineTotal)}
              </p>
            </Card>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {confirmClear ? (
            <div className="flex flex-wrap items-center gap-2" role="group">
              <span className="text-sm font-semibold">{t('plan.clearConfirm')}</span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  plan.clear();
                  setConfirmClear(false);
                }}
              >
                {t('plan.clearYes')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              {t('plan.clear')}
            </Button>
          )}
          <ButtonLink to={`/s/${code}`} variant="secondary">
            + {t('plan.addMore')}
          </ButtonLink>
        </div>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-[calc(var(--header-h,8rem)+1rem)] lg:self-start">
        <Card className="p-5 sm:p-6">
          <p className="text-sm text-muted">{t('plan.items', { count: plan.count })}</p>
          {ordering.data?.enabled === false ? (
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <p className="font-semibold">{t('plan.payAtShop')}</p>
              <p className="font-display text-3xl font-semibold">{formatPaise(total)}</p>
            </div>
          ) : (
            <dl className="mt-2 divide-y divide-line rounded-2xl border border-line">
              <div className="flex items-baseline justify-between gap-3 px-4 py-3">
                <dt className="text-sm font-semibold">{t('plan.payNow')}</dt>
                <dd className="font-display text-xl font-bold text-plum">{fee}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-4 py-3">
                <dt className="text-sm font-semibold">{t('plan.payAtShop')}</dt>
                <dd className="font-display text-2xl font-bold">{formatPaise(total)}</dd>
              </div>
            </dl>
          )}
          <p className="mt-2 text-xs text-muted">{t('plan.estimate')}</p>
          {unavailable > 0 && (
            <Notice tone="danger" className="mt-4">
              {t('plan.unavailable', { count: unavailable })}
            </Notice>
          )}
          <div className="mt-6 grid gap-3">
            {ordering.data?.enabled === false ? (
              <Notice>{t('plan.orderingOff')}</Notice>
            ) : !me ? (
              <ButtonLink to={`/login?next=${encodeURIComponent(`/s/${code}/plan`)}`} size="lg">
                {t('plan.signInToOrder')}
              </ButtonLink>
            ) : (
              <>
                <div ref={placeRef} className="grid">
                  <Button
                    size="lg"
                    onClick={placeOrder}
                    disabled={place.isPending || unavailable > 0 || !ordering.data}
                  >
                    {place.isPending ? t('plan.placing') : t('plan.placeOrder', { fee })}
                  </Button>
                </div>
                {unavailable > 0 && (
                  <p className="text-xs text-danger">{t('plan.removeUnavailable')}</p>
                )}
                <p className="text-xs text-muted">{t('plan.feeNote', { fee })}</p>
                <ErrorText error={place.error} />
              </>
            )}
            <Button variant="secondary" onClick={() => setWalkIn((v) => !v)}>
              {walkIn ? t('plan.hideQr') : t('plan.walkInQr')}
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted">{t('plan.finalNote')}</p>
        </Card>
        {walkIn && (
          <div ref={qrRef} className="scroll-mt-[calc(var(--header-h,4rem)+1rem)]">
            <Card className="p-6 text-center">
              <p className="font-semibold">{t('plan.walkInTitle')}</p>
              <p className="mb-4 text-sm text-muted">{t('plan.walkInBody')}</p>
              <QrCode
                text={encodePlan({
                  visitCode: null,
                  shopCode: code,
                  priceVersion,
                  lines: plan.lines,
                })}
                label={t('plan.walkInTitle')}
                className="mx-auto w-64 [&>svg]:h-auto [&>svg]:w-full"
              />
              <div className="mt-4 text-left">
                <SafetyNotice />
              </div>
            </Card>
          </div>
        )}
      </aside>

      {me && ordering.data?.enabled && unavailable === 0 && !placeInView && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 p-3 sm:hidden">
          <div className="glass-dark flex items-center justify-between gap-3 rounded-3xl py-3 pr-3 pl-5 text-white shadow-[var(--shadow-lift)] ring-1 ring-white/10">
            <p className="min-w-0 text-sm font-semibold">
              {t('plan.barSplit', { fee, total: formatPaise(total) })}
            </p>
            <Button
              size="lg"
              className="shrink-0 whitespace-nowrap"
              onClick={placeOrder}
              disabled={place.isPending}
            >
              {place.isPending ? t('plan.placing') : t('plan.placeShort')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
