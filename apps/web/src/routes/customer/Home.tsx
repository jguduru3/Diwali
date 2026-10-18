import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ShopSummary } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, ButtonLink, Card, EmptyState, cx } from '../../components/ui';
import { daysToDiwali, slotRange, dayIST } from '../../lib/format';
import { useAreas, useShops } from '../../lib/queries';

const ShopMap = lazy(() => import('../../components/ShopMap'));

function Hero() {
  const { t } = useTranslation();
  const days = daysToDiwali();
  const steps = [
    { n: '01', title: t('home.step1'), body: t('home.step1Body') },
    { n: '02', title: t('home.step2'), body: t('home.step2Body') },
    { n: '03', title: t('home.step3'), body: t('home.step3Body') },
  ];
  return (
    <section className="night-sky relative overflow-hidden rounded-[2rem] px-6 py-10 text-white shadow-[var(--shadow-lift)] sm:px-10 sm:py-14">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-gold/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-rose/20 blur-3xl"
      />
      <div className="relative grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="gold" className="bg-gold/20 text-gold-light ring-gold/40">
              {t('home.eyebrow')}
            </Badge>
            {days !== null && (
              <Badge tone="gold" className="bg-white/10 text-white ring-white/20">
                {days === 0 ? t('home.diwaliToday') : t('home.daysToGo', { count: days })}
              </Badge>
            )}
          </div>
          <h1 className="mt-5 text-4xl leading-[1.05] font-semibold text-white sm:text-6xl">
            {t('home.titleA')} <span className="gold-text">{t('home.titleB')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/80">{t('app.tagline')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#shops" className="contents">
              <span className="inline-flex min-h-14 items-center rounded-2xl bg-gradient-to-br from-gold-light via-gold to-saffron px-7 font-semibold text-night shadow-[var(--shadow-glow)]">
                {t('home.cta')}
              </span>
            </a>
            <ButtonLink
              to="/about"
              variant="ghost"
              size="lg"
              className="text-white hover:bg-white/10"
            >
              {t('home.how')}
            </ButtonLink>
          </div>
        </div>
        <ol className="grid gap-3">
          {steps.map((s) => (
            <li
              key={s.n}
              className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
            >
              <span className="font-display text-2xl text-gold">{s.n}</span>
              <span>
                <span className="block font-semibold text-white">{s.title}</span>
                <span className="block text-sm text-white/70">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ShopCard({ shop }: { shop: ShopSummary }) {
  const { t } = useTranslation();
  const next = shop.nextFreeSlot;
  return (
    <Card
      as="article"
      className="group relative flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-semibold">
            <Link
              to={`/s/${shop.shortCode}`}
              className="after:absolute after:inset-0 focus:outline-none"
            >
              {shop.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {shop.area}
            {shop.distanceKm != null && ` · ${t('home.km', { km: shop.distanceKm })}`}
            {shop.cluster && ` · ${shop.cluster.name}`}
          </p>
        </div>
        <Badge tone={shop.openNow ? 'emerald' : 'muted'}>
          <span
            className={cx('h-1.5 w-1.5 rounded-full', shop.openNow ? 'bg-emerald' : 'bg-muted')}
          />
          {shop.openNow ? t('home.open') : t('home.closed')}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="gold">
          ✓{' '}
          {t('home.licenceBadge', {
            type: shop.licence.licenceType,
            date: dayIST(shop.licence.validTo),
          })}
        </Badge>
        <Badge tone="emerald">🌿 {t('home.greenOnly')}</Badge>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3 border-t border-line/70 pt-4">
        <div className="text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t('home.nextSlot')}
          </p>
          {next ? (
            <p className="font-semibold">
              {dayIST(next.startsAt)}, {slotRange(next.startsAt, next.endsAt)}
              <span className="ml-1 font-normal text-muted">
                · {t('home.left', { count: next.remaining })}
              </span>
            </p>
          ) : (
            <p className="font-semibold text-muted">{t('home.noSlots')}</p>
          )}
        </div>
        <span className="relative font-semibold text-plum transition group-hover:translate-x-0.5">
          {t('home.viewPrices')} →
        </span>
      </div>
    </Card>
  );
}

export function Home() {
  const { t } = useTranslation();
  const [area, setArea] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState(false);
  const [locating, setLocating] = useState(false);
  const { data: areas } = useAreas();
  const shops = useShops({ area: area || undefined, lat: pos?.lat, lng: pos?.lng });

  const locate = () => {
    setLocError(false);
    if (!navigator.geolocation) return setLocError(true);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setArea('');
        setLocating(false);
      },
      () => {
        setLocError(true);
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const center = pos
    ? ([pos.lat, pos.lng] as [number, number])
    : (() => {
        const a = areas?.find((x) => x.area === area);
        return a ? ([a.lat, a.lng] as [number, number]) : undefined;
      })();

  return (
    <div className="space-y-10">
      <Hero />

      <section id="shops" className="scroll-mt-40">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-gold-deep uppercase">
              {t('home.findEyebrow')}
            </p>
            <h2 className="mt-1 text-3xl font-semibold">{t('home.findTitle')}</h2>
          </div>
          <Button variant="secondary" onClick={locate} disabled={locating}>
            <span aria-hidden>◎</span> {locating ? t('common.loading') : t('home.useLocation')}
          </Button>
        </div>

        <div
          role="radiogroup"
          aria-label={t('home.area')}
          className="mb-6 flex gap-2 overflow-x-auto pb-1"
        >
          {[{ area: '', shopCount: shops.data?.length ?? 0 }, ...(areas ?? [])].map((a) => {
            const active = area === a.area && !pos;
            return (
              <button
                key={a.area || 'all'}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setArea(a.area);
                  setPos(null);
                }}
                className={cx(
                  'min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition',
                  active
                    ? 'border-plum bg-plum text-white'
                    : 'border-line bg-white text-ink hover:border-plum/40',
                )}
              >
                {a.area || t('home.allAreas')}
                {a.area && (
                  <span className={cx('ml-1.5', active ? 'text-gold-light' : 'text-muted')}>
                    {a.shopCount}
                  </span>
                )}
              </button>
            );
          })}
          {pos && (
            <span className="flex min-h-11 shrink-0 items-center rounded-full bg-gold-light/50 px-4 text-sm font-semibold text-gold-deep">
              ◎ {t('home.nearYou')}
            </span>
          )}
        </div>
        {locError && <p className="mb-4 text-sm text-danger">{t('home.locationError')}</p>}

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4">
            {shops.isPending && <ShopSkeletons />}
            <ErrorText error={shops.error} />
            {shops.data?.length === 0 && (
              <EmptyState icon="🪔" title={t('home.noShopsTitle')} body={t('home.noShopsBody')} />
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {shops.data?.map((s) => (
                <ShopCard key={s.shortCode} shop={s} />
              ))}
            </div>
          </div>
          <div className="h-80 overflow-hidden rounded-3xl border border-line shadow-[var(--shadow-card)] lg:sticky lg:top-40 lg:h-[34rem]">
            <Suspense fallback={<div className="h-full w-full animate-pulse bg-sand" />}>
              {shops.data && (
                <ShopMap
                  key={`${center?.join(',')}`}
                  shops={shops.data}
                  center={center}
                  you={pos ? [pos.lat, pos.lng] : undefined}
                />
              )}
            </Suspense>
          </div>
        </div>
      </section>
    </div>
  );
}

function ShopSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card h-48 animate-pulse bg-white/60" />
      ))}
    </div>
  );
}
