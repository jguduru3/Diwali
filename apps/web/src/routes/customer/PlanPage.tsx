import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PLATFORM_FEE_PAISE, encodePlan, formatGrams, formatPaise } from '@pataka/shared';
import { useMe } from '../../auth/useAuth';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import { SafetyNotice } from '../../components/SafetyNotice';
import { QtyStepper } from '../../components/QtyStepper';
import { WeightStepper } from '../../components/WeightStepper';
import { Badge, Button, ButtonLink, Card, EmptyState, Notice, Spinner } from '../../components/ui';
import { itemName } from '../../lib/format';
import { usePlan } from '../../lib/planList';
import { useOrderingInfo, usePlaceOrder, useShop, useShopItems } from '../../lib/queries';
import { useWeights } from '../../lib/weightList';
import { usePlanDetails, useWeightDetails } from './usePlanDetails';

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
  const packs = usePlanDetails(plan.lines, items.data);
  const weights = useWeights(code);
  const weighed = useWeightDetails(weights.lines, items.data);
  const rows = packs.rows;
  const total = packs.total + weighed.total;
  const unavailable = packs.unavailable + weighed.unavailable;
  const count = plan.count + weights.lines.length;
  const [walkIn, setWalkIn] = useState(false);
  const { data: me } = useMe();
  const ordering = useOrderingInfo();
  const place = usePlaceOrder();
  const fee = formatPaise(ordering.data?.feePaise ?? PLATFORM_FEE_PAISE);

  const placeOrder = () => {
    const lines = [
      ...rows.filter((r) => r.item).map((r) => ({ itemId: r.item!.id, qty: r.qty })),
      ...weighed.rows
        .filter((r) => r.item)
        .map((r) =>
          r.item!.saleUnit === 'mix_kg'
            ? { itemId: r.itemId, grams: r.grams, mixItemIds: r.mixItemIds ?? [] }
            : { itemId: r.itemId, grams: r.grams },
        ),
    ];
    place.mutate(
      { shopCode: code, lines },
      {
        onSuccess: (order) => {
          plan.clear();
          weights.clear();
          if (order.fee.checkout) navigate(order.fee.checkout.url);
          else navigate(`/orders/${order.id}`);
        },
      },
    );
  };

  if (items.isPending) return <Spinner label={t('common.loading')} />;
  if (!count) {
    return (
      <EmptyState
        icon="🪔"
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
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t('plan.title')}</h1>
        <p className="mt-1 text-muted">{t('plan.onPhone')}</p>
        {changed && <Notice className="mt-4">{t('plan.pricesChanged')}</Notice>}

        <ul className="mt-5 space-y-3">
          {rows.map((r) => (
            <Card as="li" key={r.itemNo} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
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
              <p className="w-20 text-right font-display text-lg font-semibold">
                {formatPaise(r.lineTotal)}
              </p>
            </Card>
          ))}
          {weighed.rows.map((r) => (
            <Card as="li" key={r.itemId} className="p-4">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {r.item ? itemName(r.item) : t('plan.unknownItem', { no: r.itemNo })}
                  </p>
                  <p className="text-sm text-muted">
                    {r.item && `${formatPaise(r.item.effectivePricePaise)}${t('weight.perKg')}`}
                  </p>
                  {r.item?.isSoldOut && (
                    <Badge tone="danger" className="mt-1">
                      {t('shopPage.soldOut')}
                    </Badge>
                  )}
                </div>
                <WeightStepper
                  grams={r.grams}
                  name={r.item ? itemName(r.item) : `#${r.itemNo}`}
                  onChange={(g) => weights.set({ ...r, grams: g })}
                />
                <p className="w-20 text-right font-display text-lg font-semibold">
                  {formatPaise(r.lineTotal)}
                </p>
              </div>
              {r.mix.length > 0 && (
                <p className="mt-2 text-sm text-muted">
                  {t('weight.mixOf', { items: r.mix.map((m) => itemName(m)).join(', ') })}
                </p>
              )}
            </Card>
          ))}
        </ul>
        {weighed.rows.length > 0 && <Notice className="mt-4">{t('weight.weighedNote')}</Notice>}
        <div className="mt-4 flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              plan.clear();
              weights.clear();
            }}
          >
            {t('plan.clear')}
          </Button>
          <ButtonLink to={`/s/${code}`} variant="secondary">
            + {t('plan.addMore')}
          </ButtonLink>
        </div>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-40 lg:self-start">
        <Card className="p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-muted">{t('plan.items', { count })}</p>
            <p className="font-display text-3xl font-semibold">{formatPaise(total)}</p>
          </div>
          <p className="mt-1 text-right text-xs text-muted">{t('plan.estimate')}</p>
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
                <Button
                  size="lg"
                  onClick={placeOrder}
                  disabled={place.isPending || unavailable > 0 || !ordering.data}
                >
                  {place.isPending ? t('plan.placing') : t('plan.placeOrder', { fee })}
                </Button>
                {unavailable > 0 && (
                  <p className="text-xs text-danger">{t('plan.removeUnavailable')}</p>
                )}
                <p className="text-xs text-muted">{t('plan.feeNote', { fee })}</p>
                <ErrorText error={place.error} />
              </>
            )}
            {plan.lines.length > 0 && (
              <Button variant="secondary" onClick={() => setWalkIn((v) => !v)}>
                {walkIn ? t('plan.hideQr') : t('plan.walkInQr')}
              </Button>
            )}
          </div>
          <p className="mt-4 text-xs text-muted">{t('plan.finalNote')}</p>
        </Card>
        {walkIn && (
          <Card className="p-6 text-center">
            <p className="font-semibold">{t('plan.walkInTitle')}</p>
            <p className="mb-4 text-sm text-muted">{t('plan.walkInBody')}</p>
            {weighed.rows.length > 0 && (
              <p className="mb-4 text-xs text-muted">
                {t('weight.notInListQr', {
                  items: weighed.rows
                    .map((r) => `${r.item ? itemName(r.item) : r.itemNo} ${formatGrams(r.grams)}`)
                    .join(', '),
                })}
              </p>
            )}
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
        )}
      </aside>
    </div>
  );
}
