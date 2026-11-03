import { lazy, Suspense, useEffect, useState } from 'react';
import { KitsStrip } from './KitsPage';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ShopSummary } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, ButtonLink, Card, EmptyState, cx } from '../../components/ui';
import { daysToDiwali, dayIST } from '../../lib/format';
import { useAreas, useShops } from '../../lib/queries';
import { Check, Leaf, Search, Store, Zap } from 'lucide-react';
import { Icon } from '../../components/Icon';

const ShopMap = lazy(() => import('../../components/ShopMap'));

function GpsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

const ROTATE_MS = 5000;

// Module-level so the location prompt fires once per app load, not on every visit back to Home.
let autoLocateTried = false;

// "Near you" shows only shops within this distance of the customer.
const NEAR_KM = 5;

function RotatingMessages() {
  const { t } = useTranslation();
  const messages = [
    { title: null, body: t('app.tagline') },
    { title: t('home.step1'), body: t('home.step1Body') },
    { title: t('home.step2'), body: t('home.step2Body') },
    { title: t('home.step3'), body: t('home.step3Body') },
  ];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((i) => (i + 1) % messages.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, messages.length]);

  return (
    // Every message sits in the same grid cell, so the block keeps the tallest one's height
    // and the fade is a crossfade with no layout shift. Hovering pauses the rotation.
    <div
      className="mt-5 grid max-w-xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {messages.map((m, i) => (
        <p
          key={i}
          aria-hidden={i !== active}
          className={cx(
            'text-lg text-white/80 transition-opacity duration-700 ease-in-out [grid-area:1/1]',
            i === active ? 'opacity-100' : 'opacity-0',
          )}
        >
          {m.title && <span className="block font-semibold text-gold-light">{m.title}</span>}
          {m.body}
        </p>
      ))}
    </div>
  );
}

function Hero({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const { t } = useTranslation();
  const days = daysToDiwali();
  return (
    <section className="night-sky relative overflow-hidden rounded-3xl px-5 py-7 text-white shadow-[var(--shadow-lift)] sm:px-10 sm:py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-gold/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-rose/20 blur-3xl"
      />
      <div className="relative">
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
          <h1 className="mt-4 text-3xl leading-[1.05] font-extrabold text-white sm:text-5xl">
            {t('home.titleA')} <span className="text-brand-300">{t('home.titleB')}</span>
          </h1>
          <RotatingMessages />
          <label className="mt-6 flex max-w-xl items-center gap-3 rounded-full bg-white px-4 text-ink shadow-[var(--shadow-lift)]">
            <Icon icon={Search} className="h-5 w-5 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t('home.search')}
              aria-label={t('home.search')}
              className="min-h-12 w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-subtle"
            />
          </label>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="#shops" className="contents">
              <span className="inline-flex min-h-12 items-center rounded-full bg-white px-6 font-bold text-plum">
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
      </div>
    </section>
  );
}

function ShopCard({ shop }: { shop: ShopSummary }) {
  const { t } = useTranslation();
  return (
    <Card
      as="article"
      className="group relative flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-bold">
            {/* The link's ::after covers the whole card, above the hover-animated parts, so a
                click anywhere on the card (including "View products") opens the shop. */}
            <Link
              to={`/s/${shop.shortCode}`}
              className="after:absolute after:inset-0 after:z-10 focus:outline-none"
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
          <Icon icon={Check} />{' '}
          {t('home.licenceBadge', {
            type: shop.licence.licenceType,
            date: dayIST(shop.licence.validTo),
          })}
        </Badge>
        <Badge tone="emerald">
          <Icon icon={Leaf} /> {t('home.greenOnly')}
        </Badge>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3 border-t border-line/70 pt-4">
        <p className="text-sm font-semibold text-gold-deep">
          <Icon icon={Zap} /> {t('home.expressPickup')}
        </p>
        <span
          aria-hidden
          className="font-semibold text-plum transition group-hover:translate-x-0.5"
        >
          {t('home.viewPrices')} →
        </span>
      </div>
    </Card>
  );
}

const PAGE = 24;

export function Home() {
  const { t } = useTranslation();
  const [area, setArea] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [nearMe, setNearMe] = useState(false);
  const [query, setQuery] = useState('');
  const { data: areas } = useAreas();
  const shops = useShops({
    area: nearMe ? undefined : area || undefined,
    lat: pos?.lat,
    lng: pos?.lng,
  });
  // Thousands of shops can be listed; cards render in pages so phones stay fast (the map shows all).
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [area, nearMe]);
  const q = query.trim().toLowerCase();
  const visible = (
    nearMe ? shops.data?.filter((s) => s.distanceKm != null && s.distanceKm <= NEAR_KM) : shops.data
  )?.filter((s) => !q || `${s.name} ${s.area}`.toLowerCase().includes(q));

  // `auto` is the attempt made when the app opens: a refusal there stays quiet, since the
  // customer didn't press anything and can still pick an area or tap "Use my location".
  const locate = (auto = false) => {
    setLocError(false);
    if (!navigator.geolocation) {
      if (!auto) setLocError(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setNearMe(true);
        setLocating(false);
      },
      () => {
        if (!auto) setLocError(true);
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  useEffect(() => {
    if (autoLocateTried) return;
    autoLocateTried = true;
    // Don't re-ask someone who has already blocked location for this site.
    if (!navigator.permissions) return locate(true);
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (p.state !== 'denied') locate(true);
      })
      .catch(() => locate(true));
  }, []);

  const center =
    nearMe && pos
      ? ([pos.lat, pos.lng] as [number, number])
      : (() => {
          const a = areas?.find((x) => x.area === area);
          return a ? ([a.lat, a.lng] as [number, number]) : undefined;
        })();

  return (
    <div className="space-y-10">
      <Hero query={query} onQuery={setQuery} />

      <KitsStrip />

      <section id="shops" className="scroll-mt-40">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-gold-deep uppercase">
              {t('home.findEyebrow')}
            </p>
            <h2 className="mt-1 text-3xl font-bold">{t('home.findTitle')}</h2>
          </div>
          <Button variant="secondary" onClick={() => locate()} disabled={locating}>
            <GpsIcon className={cx('h-5 w-5', locating && 'animate-pulse')} />
            {locating ? t('common.loading') : t('home.useLocation')}
          </Button>
        </div>

        <div
          role="radiogroup"
          aria-label={t('home.area')}
          className="mb-6 flex gap-2 overflow-x-auto pb-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={nearMe}
            disabled={locating}
            onClick={() => (pos ? setNearMe(true) : locate())}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition',
              nearMe
                ? 'border-plum bg-plum text-white'
                : 'border-line bg-white text-ink hover:border-plum/40',
            )}
          >
            <GpsIcon className={cx('h-4 w-4', locating && 'animate-pulse')} />
            {t('home.nearYou')}
            {nearMe && visible && <span className="text-gold-light">{visible.length}</span>}
          </button>
          {[{ area: '', shopCount: shops.data?.length ?? 0 }, ...(areas ?? [])].map((a) => {
            const active = area === a.area && !nearMe;
            return (
              <button
                key={a.area || 'all'}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setArea(a.area);
                  setNearMe(false);
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
        </div>
        {locError && <p className="mb-4 text-sm text-danger">{t('home.locationError')}</p>}

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4">
            {shops.isPending && <ShopSkeletons />}
            <ErrorText error={shops.error} />
            {visible?.length === 0 &&
              (nearMe ? (
                <EmptyState
                  icon={<Icon icon={Store} className="h-6 w-6" />}
                  title={t('home.noNearTitle', { km: NEAR_KM })}
                  body={t('home.noNearBody')}
                />
              ) : (
                <EmptyState
                  icon={<Icon icon={Store} className="h-6 w-6" />}
                  title={t('home.noShopsTitle')}
                  body={t('home.noShopsBody')}
                />
              ))}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {visible?.slice(0, shown).map((s) => (
                <ShopCard key={s.shortCode} shop={s} />
              ))}
            </div>
            {visible && visible.length > shown && (
              <div className="flex flex-col items-center gap-2 pt-2">
                <p className="text-sm text-muted tabular-nums">
                  {t('home.showing', { shown, total: visible.length })}
                </p>
                <Button variant="secondary" onClick={() => setShown(shown + PAGE)}>
                  {t('home.showMore')}
                </Button>
              </div>
            )}
          </div>
          <div className="h-80 overflow-hidden rounded-3xl border border-line shadow-[var(--shadow-card)] lg:sticky lg:top-40 lg:h-[34rem]">
            <Suspense fallback={<div className="h-full w-full animate-pulse bg-sand" />}>
              {visible && (
                <ShopMap
                  key={`${center?.join(',')}`}
                  shops={visible}
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
