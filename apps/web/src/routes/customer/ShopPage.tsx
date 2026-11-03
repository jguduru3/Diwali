import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { filterItems, formatPaise, sortItems, type Item } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { GreenBadge } from '../../components/GreenBadge';
import { QtyStepper } from '../../components/QtyStepper';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  Spinner,
  cx,
} from '../../components/ui';
import { categoryName, dayIST, formatWeight, itemName } from '../../lib/format';
import { usePlan } from '../../lib/planList';
import { useShop, useShopItems } from '../../lib/queries';
import { ShopFilters } from './ShopFilters';
import { NO_FILTERS, type ShopFilterState } from './shopFilterState';
import { usePlanDetails } from './usePlanDetails';

/** Large image and full details for one product, as a native modal dialog (focus trap,
 *  Esc to close). A bottom sheet on phones, a centred card on wider screens. */
function ProductDetail({
  item,
  category,
  qty,
  onQty,
  onClose,
}: {
  item: Item;
  category?: string;
  qty: number;
  onQty: (n: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const name = itemName(item);
  const onOffer = item.effectivePricePaise < item.pricePaise;

  useEffect(() => {
    ref.current?.showModal?.();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={name}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="mx-auto mt-auto mb-0 max-h-[92dvh] w-full max-w-none animate-pop-in overflow-y-auto rounded-t-3xl bg-white p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-night/60 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="relative">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={name}
            className={cx(
              'aspect-[4/3] w-full bg-sand object-cover',
              item.isSoldOut && 'opacity-70 grayscale',
            )}
          />
        ) : (
          <div
            className={cx(
              'grid aspect-[4/3] w-full place-items-center bg-brand-050 font-display text-6xl font-extrabold text-plum',
              item.isSoldOut && 'opacity-70 grayscale',
            )}
          >
            #{item.itemNo}
          </div>
        )}
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label={t('common.close')}
          className="absolute top-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-xl text-ink shadow-[var(--shadow-card)] backdrop-blur transition hover:bg-white"
        >
          <span aria-hidden>×</span>
        </button>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-gold-deep uppercase">
            {[category, t('shopPage.itemNo', { no: item.itemNo })].filter(Boolean).join(' · ')}
          </p>
          <h2 className="mt-1 text-2xl leading-tight font-bold">{name}</h2>
          {item.packDesc && <p className="mt-1 text-muted">{item.packDesc}</p>}
          {item.saleMode === 'kilo' && item.weightGrams != null && (
            <p className="mt-1 font-semibold text-gold-deep">
              {t('shopPage.kiloLine', {
                weight: formatWeight(item.weightGrams),
                rate: formatPaise(item.pricePerKgPaise ?? 0),
              })}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-3xl font-semibold">
            {formatPaise(item.effectivePricePaise)}
          </span>
          {onOffer && (
            <>
              <span className="text-muted line-through">{formatPaise(item.pricePaise)}</span>
              <Badge tone="saffron">{t('shopPage.offer')}</Badge>
              {item.offerEndsAt && (
                <span className="text-sm text-muted">
                  {t('shopPage.offerEnds', { date: dayIST(item.offerEndsAt) })}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <GreenBadge cert={item.greenCert} reference={item.greenRef} />
          {item.isSoldOut && <Badge tone="muted">{t('shopPage.soldOut')}</Badge>}
          {!item.isSoldOut && item.stockQty != null && item.stockQty <= 5 && (
            <Badge tone="danger">{t('shopPage.onlyLeft', { count: item.stockQty })}</Badge>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <p className="text-sm text-muted">{t('shopPage.detailPayNote')}</p>
          <QtyStepper qty={qty} name={name} disabled={item.isSoldOut} onChange={onQty} />
        </div>
      </div>
    </dialog>
  );
}

/** A document with a tick: the shop's verified licence. */
function LicenceIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 11.5h4M8.5 8h2" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  );
}

export function ShopPage() {
  const { t } = useTranslation();
  const code = (useParams().code ?? '').toUpperCase();
  const shop = useShop(code);
  const items = useShopItems(code);
  const plan = usePlan(code, items.data?.priceVersion);
  const details = usePlanDetails(plan.lines, items.data);
  const [filters, setFilters] = useState<ShopFilterState>(NO_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      sortItems(
        filterItems(items.data?.items ?? [], {
          categoryId: filters.cat,
          search: filters.q,
          kiloOnly: filters.kiloOnly,
          standardOnly: filters.standardOnly,
        }),
        filters.sort,
        itemName,
      ),
    [items.data, filters],
  );

  // Looked up from live data so the dialog shows current price and stock after a refetch.
  const detail = items.data?.items.find((i) => i.id === detailId);

  const setItemQty = (item: Item, n: number) =>
    setFull(!plan.setQty(item.itemNo, item.stockQty != null ? Math.min(n, item.stockQty) : n));

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
      <section className="night-sky relative overflow-hidden rounded-3xl p-6 text-white shadow-[var(--shadow-lift)] sm:p-8">
        <Link to="/" className="text-sm font-semibold text-gold-light hover:underline">
          ← {t('shopPage.allShops')}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-white sm:text-5xl">{s.name}</h1>
            <p className="mt-2 text-white/75">
              {[s.cluster?.name, s.area].filter(Boolean).join(' · ')}
              {s.openFrom && ` · ${t('shopPage.hours', { from: s.openFrom, to: s.openTo })}`}
            </p>
            <p className="mt-1 text-white/75">
              <LicenceIcon className="mr-1.5 -mt-0.5 inline h-4 w-4 text-gold-light" />
              {t('shopPage.licence', {
                no: s.licence.licenceNo,
                type: s.licence.licenceType,
                date: dayIST(s.licence.validTo),
              })}
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
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center rounded-full bg-white px-4 py-1.5 font-semibold text-night">
            ⚡ {t('home.expressPickup')}
          </span>
          {mapUrl && (
            <>
              <span aria-hidden className="h-5 w-px bg-white/25" />
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-full bg-white px-4 py-1.5 font-semibold text-plum shadow-[var(--shadow-lift)] transition hover:bg-gold-light"
              >
                ◎ {t('shopPage.map')}
              </a>
            </>
          )}
        </div>
      </section>

      <Notice className="mt-6">{t('shopPage.priceNote')}</Notice>

      <div className="sticky top-[7.5rem] z-20 -mx-4 mt-6 border-b border-line bg-ivory/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <ShopFilters
          categories={items.data?.categories ?? []}
          value={filters}
          onChange={setFilters}
          resultCount={visible.length}
          sheetOpen={sheetOpen}
          onSheet={setSheetOpen}
        />
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
                'relative flex items-stretch gap-4 p-4 transition hover:shadow-[var(--shadow-lift)]',
                item.isSoldOut && 'opacity-70 grayscale',
                qty > 0 && 'ring-2 ring-gold/60',
              )}
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="min-h-20 w-20 shrink-0 self-stretch rounded-2xl object-cover ring-1 ring-line"
                />
              ) : (
                <div className="grid min-h-20 w-20 shrink-0 place-items-center self-stretch rounded-2xl bg-brand-050 font-display text-2xl font-extrabold text-plum">
                  #{item.itemNo}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">
                  {/* The button's ::after covers the card, so tapping the photo or text opens
                      the details; the stepper sits above it (z-10) and still adds items. */}
                  <button
                    type="button"
                    onClick={() => setDetailId(item.id)}
                    aria-haspopup="dialog"
                    className="text-left after:absolute after:inset-0 after:rounded-[inherit] hover:text-plum focus:outline-none"
                  >
                    {name}
                  </button>
                </p>
                <p className="text-sm text-muted">{item.packDesc}</p>
                {item.saleMode === 'kilo' && item.weightGrams != null && (
                  <p className="text-sm font-semibold text-gold-deep">
                    {t('shopPage.kiloLine', {
                      weight: formatWeight(item.weightGrams),
                      rate: formatPaise(item.pricePerKgPaise ?? 0),
                    })}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-semibold">
                    {formatPaise(item.effectivePricePaise)}
                  </span>
                  {item.effectivePricePaise < item.pricePaise && (
                    <>
                      <span className="text-sm text-muted line-through">
                        {formatPaise(item.pricePaise)}
                      </span>
                      <Badge tone="saffron">{t('shopPage.offer')}</Badge>
                    </>
                  )}
                  <GreenBadge cert={item.greenCert} />
                  {item.isStandard && (
                    <Badge tone="emerald" className="bg-emerald/15 text-emerald font-semibold">
                      ★ {t('shopPage.standardProduct')}
                    </Badge>
                  )}
                  {item.isSoldOut && <Badge tone="muted">{t('shopPage.soldOut')}</Badge>}
                  {!item.isSoldOut && item.stockQty != null && item.stockQty <= 5 && (
                    <Badge tone="danger">{t('shopPage.onlyLeft', { count: item.stockQty })}</Badge>
                  )}
                </div>
              </div>
              <div className="relative z-10 shrink-0 self-start">
                <QtyStepper
                  qty={qty}
                  name={name}
                  disabled={item.isSoldOut}
                  onChange={(n) => setItemQty(item, n)}
                />
              </div>
            </Card>
          );
        })}
      </ul>
      {items.data && visible.length === 0 && (
        <EmptyState
          title={t('shopPage.noMatch')}
          action={
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t('shopPage.clearAll')}
            </Button>
          }
        />
      )}

      {detail && (
        <ProductDetail
          key={detail.id}
          item={detail}
          category={(() => {
            const c = items.data?.categories.find((x) => x.id === detail.categoryId);
            return c && categoryName(c);
          })()}
          qty={plan.qtyOf(detail.itemNo)}
          onQty={(n) => setItemQty(detail, n)}
          onClose={() => setDetailId(null)}
        />
      )}

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
