import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { encodePlan, formatPaise } from '@pataka/shared';
import { QrCode } from '../../components/QrCode';
import { QtyStepper } from '../../components/QtyStepper';
import { Badge, Button, ButtonLink, Card, EmptyState, Notice, Spinner } from '../../components/ui';
import { itemName } from '../../lib/format';
import { usePlan } from '../../lib/planList';
import { useShop, useShopItems } from '../../lib/queries';
import { usePlanDetails } from './usePlanDetails';

/** SPEC §9 screen 3. The list stays on this phone; only the QR carries it to the counter. */
export function PlanPage() {
  const { t } = useTranslation();
  const code = (useParams().code ?? '').toUpperCase();
  const shop = useShop(code);
  const items = useShopItems(code);
  const plan = usePlan(code, items.data?.priceVersion);
  const { rows, total, unavailable } = usePlanDetails(plan.lines, items.data);
  const [walkIn, setWalkIn] = useState(false);

  if (items.isPending) return <Spinner label={t('common.loading')} />;
  if (!plan.lines.length) {
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
                  {r.item && `${r.item.packDesc ?? ''} · ${formatPaise(r.item.pricePaise)}`}
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
        </ul>
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={plan.clear}>
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
            <p className="text-muted">{t('plan.items', { count: plan.count })}</p>
            <p className="font-display text-3xl font-semibold">{formatPaise(total)}</p>
          </div>
          <p className="mt-1 text-right text-xs text-muted">{t('plan.estimate')}</p>
          {unavailable > 0 && (
            <Notice tone="danger" className="mt-4">
              {t('plan.unavailable', { count: unavailable })}
            </Notice>
          )}
          <div className="mt-6 grid gap-3">
            <ButtonLink to={`/s/${code}/book`} size="lg">
              {t('plan.bookSlot')}
            </ButtonLink>
            <Button variant="secondary" onClick={() => setWalkIn((v) => !v)}>
              {walkIn ? t('plan.hideQr') : t('plan.walkInQr')}
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted">{t('plan.finalNote')}</p>
        </Card>
        {walkIn && (
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
          </Card>
        )}
      </aside>
    </div>
  );
}
