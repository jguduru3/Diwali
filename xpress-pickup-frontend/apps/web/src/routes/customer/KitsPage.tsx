import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFeePaise } from '../../lib/settings';
import { formatPaise, KIT_TYPES, type KitType } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { QtyStepper } from '../../components/QtyStepper';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  PageTitle,
  Spinner,
  cx,
} from '../../components/ui';
import { getPlan, setPlanQty, usePlanShops } from '../../lib/planList';
import { Baby, Crown, Gift, Package, PiggyBank, Users, type LucideIcon } from 'lucide-react';
import { useKitOffers, useKitTypes } from '../../lib/growth';
import { NotFound } from '../NotFound';

const KIT_ICON: Partial<Record<KitType, LucideIcon>> = {
  family: Users,
  kids: Baby,
  economy: PiggyBank,
  vip: Crown,
};

/** Home strip: packs (family, kids, economy, VIP) and bundles, each with "from" price and shop count. */
export function KitsStrip() {
  const { t } = useTranslation();
  const kits = useKitTypes();
  const list = (kits.data ?? []).filter((k) => k.shops > 0);
  if (!list.length) return null;
  return (
    <section aria-labelledby="kits-title" className="space-y-3">
      <div>
        <h2 id="kits-title" className="text-2xl font-bold">
          {t('kits.title')}
        </h2>
        <p className="text-sm text-muted">{t('kits.stripBody')}</p>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0 lg:grid-cols-5">
        {list.map((k) => (
          <li key={k.type} className="w-36 shrink-0 snap-start sm:w-auto">
            <Link
              to={`/kits/${k.type}`}
              className="card flex h-full flex-col gap-2 p-4 transition hover:bg-ivory"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-050 text-plum">
                <Icon icon={KIT_ICON[k.type] ?? Package} className="h-5 w-5" />
              </span>
              <span className="font-bold leading-tight">{t(`kits.type.${k.type}`)}</span>
              {k.fromPaise != null && (
                <span className="font-display text-lg font-extrabold tabular-nums">
                  {t('kits.from', { price: formatPaise(k.fromPaise) })}
                </span>
              )}
              <span className="mt-auto text-xs font-semibold text-muted">
                {t('kits.shops', { count: k.shops })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /kits/TYPE — the same pack at every listed shop: compare contents and prices, add one. */
export function KitsPage() {
  const { t } = useTranslation();
  const type = useParams().type as KitType;
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const offers = useKitOffers(type, pos);
  const cartShops = usePlanShops();
  const feePaise = useFeePaise();
  // Re-render when any list changes, so each offer shows what is already added.
  const [, bump] = useState(0);
  if (!(KIT_TYPES as readonly string[]).includes(type)) return <NotFound />;
  const cheapest = offers.data?.length ? Math.min(...offers.data.map((o) => o.pricePaise)) : null;

  return (
    <div className="space-y-5 pb-28">
      <PageTitle
        title={t(`kits.type.${type}`)}
        subtitle={t('kits.compare')}
        action={
          <Button
            variant="secondary"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition((p) =>
                setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
              )
            }
          >
            {t('home.useLocation')}
          </Button>
        }
      />
      <KitTypeChips current={type} />
      {offers.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={offers.error} />
      {offers.data?.length === 0 && <EmptyState title={t('kits.none')} />}
      <ul className="grid gap-4 md:grid-cols-2">
        {offers.data?.map((o) => {
          const qty = getPlan(o.shopCode)?.lines.find((l) => l.itemNo === o.itemNo)?.qty ?? 0;
          return (
            <Card
              as="li"
              key={o.itemId}
              className={cx('flex gap-4 p-4', qty > 0 && 'ring-2 ring-plum/50')}
            >
              {o.imageUrl ? (
                <img
                  src={o.imageUrl}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-xl object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-brand-050 text-brand-300">
                  <Icon icon={Gift} className="h-7 w-7" />
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/s/${o.shopCode}`} className="font-bold hover:text-plum">
                    {o.shopName}
                  </Link>
                  {o.pricePaise === cheapest && (offers.data?.length ?? 0) > 1 && (
                    <Badge tone="emerald">{t('kits.lowest')}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted">
                  {o.area}
                  {o.distanceKm != null && ` · ${t('home.km', { km: o.distanceKm })}`}
                </p>
                <p className="text-sm">
                  {o.contents.map((c) => `${c.qty} × ${c.name}`).join(', ')}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-lg font-extrabold tabular-nums">
                    {formatPaise(o.pricePaise)}
                  </span>
                  {qty > 0 ? (
                    <QtyStepper
                      qty={qty}
                      name={`${o.name} · ${o.shopName}`}
                      onChange={(n) => {
                        setPlanQty(o.shopCode, o.itemNo, n, o.priceVersion);
                        bump((x) => x + 1);
                      }}
                    />
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPlanQty(o.shopCode, o.itemNo, 1, o.priceVersion);
                        bump((x) => x + 1);
                      }}
                    >
                      {t('kits.add')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </ul>

      {cartShops.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 p-3 sm:bottom-0 sm:p-5">
          <div className="glass-dark mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-3xl py-3 pr-3 pl-5 text-white shadow-[var(--shadow-lift)] ring-1 ring-white/10">
            <p className="min-w-0 text-sm font-semibold">
              {cartShops.length > 1
                ? t('cart.barFee', {
                    count: cartShops.length,
                    total: formatPaise(feePaise * cartShops.length),
                  })
                : t('cart.shopsBar', { count: cartShops.length })}
            </p>
            <ButtonLink to="/cart" size="lg" className="shrink-0 whitespace-nowrap">
              {t('cart.reviewAll')}
            </ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pack and bundle types as chips, to hop between comparisons. */
function KitTypeChips({ current }: { current?: KitType }) {
  const { t } = useTranslation();
  const kits = useKitTypes();
  const list = (kits.data ?? []).filter((k) => k.shops > 0);
  if (!list.length) return null;
  return (
    <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {list.map((k) => (
        <li key={k.type} className="shrink-0">
          <Link
            to={`/kits/${k.type}`}
            aria-current={k.type === current ? 'page' : undefined}
            className={cx(
              'inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition',
              k.type === current
                ? 'border-plum bg-plum text-white'
                : 'border-line bg-white text-ink hover:border-plum/40',
            )}
          >
            {t(`kits.type.${k.type}`)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
