import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { GreenBadge } from '../../components/GreenBadge';
import { QtyStepper } from '../../components/QtyStepper';
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  Input,
  Notice,
  Spinner,
  cx,
} from '../../components/ui';
import { categoryName, dayIST, itemName, slotRange } from '../../lib/format';
import { usePlan } from '../../lib/planList';
import { useShop, useShopItems } from '../../lib/queries';
import { usePlanDetails } from './usePlanDetails';

export function ShopPage() {
  const { t } = useTranslation();
  const code = (useParams().code ?? '').toUpperCase();
  const shop = useShop(code);
  const items = useShopItems(code);
  const plan = usePlan(code, items.data?.priceVersion);
  const details = usePlanDetails(plan.lines, items.data);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [full, setFull] = useState(false);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items.data?.items ?? []).filter(
      (i) =>
        (!cat || i.categoryId === cat) &&
        (!needle ||
          `${i.nameEn} ${i.nameTe ?? ''} ${i.packDesc ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [items.data, cat, q]);

  if (shop.isPending) return <Spinner label={t('common.loading')} />;
  if (shop.error) {
    return (
      <EmptyState
        icon="🔒"
        title={t('shopPage.notListedTitle')}
        body={t('shopPage.notListedBody')}
        action={
          <ButtonLink to="/" variant="secondary">
            {t('notFound.back')}
          </ButtonLink>
        }
      />
    );
  }
  const s = shop.data;
  const mapUrl =
    s.lat != null && s.lng != null
      ? `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`
      : null;

  return (
    <div className="pb-28">
      <section className="night-sky relative overflow-hidden rounded-[2rem] p-6 text-white shadow-[var(--shadow-lift)] sm:p-8">
        <Link to="/" className="text-sm font-semibold text-gold-light hover:underline">
          ← {t('shopPage.allShops')}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white sm:text-5xl">{s.name}</h1>
            <p className="mt-2 text-white/75">
              {[s.cluster?.name, s.area].filter(Boolean).join(' · ')}
              {s.openFrom && ` · ${t('shopPage.hours', { from: s.openFrom, to: s.openTo })}`}
            </p>
          </div>
          <Badge
            tone={s.openNow ? 'emerald' : 'muted'}
            className={
              s.openNow
                ? 'bg-emerald/25 text-white ring-emerald/50'
                : 'bg-white/10 text-white/80 ring-white/20'
            }
          >
            {s.openNow ? t('home.open') : t('home.closed')}
          </Badge>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">
            ✓{' '}
            {t('shopPage.licence', {
              no: s.licence.licenceNo,
              type: s.licence.licenceType,
              date: dayIST(s.licence.validTo),
            })}
          </span>
          {s.nextFreeSlot && (
            <span className="rounded-full bg-gold/20 px-3 py-1.5 text-gold-light ring-1 ring-gold/40">
              {t('home.nextSlot')}: {dayIST(s.nextFreeSlot.startsAt)},{' '}
              {slotRange(s.nextFreeSlot.startsAt, s.nextFreeSlot.endsAt)}
            </span>
          )}
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15 hover:bg-white/15"
            >
              ◎ {t('shopPage.map')}
            </a>
          )}
        </div>
      </section>

      <Notice className="mt-6">{t('shopPage.priceNote')}</Notice>

      <div className="sticky top-[7.5rem] z-20 -mx-4 mt-6 bg-ivory/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="search"
            placeholder={t('shopPage.search')}
            aria-label={t('shopPage.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-0 sm:max-w-xs"
          />
          <div
            role="radiogroup"
            aria-label={t('shopPage.categories')}
            className="flex gap-2 overflow-x-auto"
          >
            {[
              { id: '', label: t('shopPage.all') },
              ...(items.data?.categories ?? []).map((c) => ({ id: c.id, label: categoryName(c) })),
            ].map((c) => (
              <button
                key={c.id || 'all'}
                type="button"
                role="radio"
                aria-checked={cat === c.id}
                onClick={() => setCat(c.id)}
                className={cx(
                  'min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition',
                  cat === c.id
                    ? 'border-plum bg-plum text-white'
                    : 'border-line bg-white hover:border-plum/40',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={items.error} />
      {full && (
        <Notice tone="danger" className="mb-3">
          {t('shopPage.full')}
        </Notice>
      )}

      <ul className="mt-2 grid gap-3 md:grid-cols-2">
        {visible.map((item) => {
          const qty = plan.qtyOf(item.itemNo);
          const name = itemName(item);
          return (
            <Card
              as="li"
              key={item.id}
              className={cx(
                'flex items-center gap-4 p-4 transition',
                item.isSoldOut && 'opacity-60',
                qty > 0 && 'ring-2 ring-gold/60',
              )}
            >
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sand to-gold-light/40 font-display text-lg font-semibold text-gold-deep">
                #{item.itemNo}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{name}</p>
                <p className="text-sm text-muted">{item.packDesc}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-semibold">
                    {formatPaise(item.pricePaise)}
                  </span>
                  <GreenBadge cert={item.greenCert} />
                  {item.isSoldOut && <Badge tone="muted">{t('shopPage.soldOut')}</Badge>}
                </div>
              </div>
              <QtyStepper
                qty={qty}
                name={name}
                disabled={item.isSoldOut}
                onChange={(n) => setFull(!plan.setQty(item.itemNo, n))}
              />
            </Card>
          );
        })}
      </ul>
      {items.data && visible.length === 0 && <EmptyState title={t('shopPage.noMatch')} />}

      {plan.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3 sm:p-5">
          <div className="night-sky mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-3xl px-5 py-4 text-white shadow-[var(--shadow-lift)] ring-1 ring-white/10">
            <div>
              <p className="text-xs font-semibold tracking-wider text-gold-light uppercase">
                {t('plan.title')}
              </p>
              <p className="font-semibold">
                {t('plan.summary', { count: plan.count, total: formatPaise(details.total) })}
              </p>
            </div>
            <ButtonLink to={`/s/${code}/plan`} size="lg">
              {t('plan.view')} →
            </ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}
