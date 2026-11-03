import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise, KIT_TYPES, type KitType } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Button, ButtonLink, Card, EmptyState, PageTitle, Spinner, cx } from '../../components/ui';
import { useKitOffers, useKitTypes } from '../../lib/growth';
import { NotFound } from '../NotFound';

/** Kits strip for the home page: the five standard kit types with shop counts. */
export function KitsStrip() {
  const { t } = useTranslation();
  const kits = useKitTypes();
  if (!kits.data?.some((k) => k.shops > 0)) return null;
  return (
    <section aria-labelledby="kits-title" className="space-y-3">
      <h2 id="kits-title" className="text-xl font-bold">
        {t('kits.title')}
      </h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:px-0">
        {kits.data.map((k) => (
          <li key={k.type} className="min-w-40 shrink-0">
            <Link
              to={`/kits/${k.type}`}
              className={cx(
                'card block h-full p-4 transition hover:bg-ivory',
                k.shops === 0 && 'pointer-events-none opacity-50',
              )}
            >
              <p className="font-bold">{t(`kits.type.${k.type}`)}</p>
              <p className="text-sm text-muted">{t('kits.shops', { count: k.shops })}</p>
              {k.fromPaise != null && (
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {t('kits.from', { price: formatPaise(k.fromPaise) })}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /kits/TYPE — every listed shop offering this kit, nearest first once located. */
export function KitsPage() {
  const { t } = useTranslation();
  const type = useParams().type as KitType;
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const offers = useKitOffers(type, pos);
  if (!(KIT_TYPES as readonly string[]).includes(type)) return <NotFound />;
  return (
    <div className="space-y-5">
      <PageTitle
        eyebrow={t('kits.eyebrow')}
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
      {offers.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={offers.error} />
      {offers.data?.length === 0 && <EmptyState title={t('kits.none')} />}
      <ul className="grid gap-4 md:grid-cols-2">
        {offers.data?.map((o) => (
          <Card as="li" key={o.itemId} className="flex gap-4 p-4">
            {o.imageUrl ? (
              <img
                src={o.imageUrl}
                alt=""
                className="h-20 w-20 shrink-0 rounded-xl object-cover"
                loading="lazy"
              />
            ) : (
              <span className="h-20 w-20 shrink-0 rounded-xl bg-brand-050" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-bold">{o.shopName}</p>
              <p className="text-sm text-muted">
                {o.area}
                {o.distanceKm != null && ` · ${t('home.km', { km: o.distanceKm })}`}
              </p>
              <p className="text-sm">{o.contents.map((c) => `${c.qty} × ${c.name}`).join(', ')}</p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-lg font-extrabold tabular-nums">
                  {formatPaise(o.pricePaise)}
                </span>
                <ButtonLink to={`/s/${o.shopCode}`} size="sm">
                  {t('kits.request')}
                </ButtonLink>
              </div>
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
