import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ITEM_SORTS, type Category } from '@pataka/shared';
import { Button, Input, Toggle, cx } from '../../components/ui';
import { categoryName } from '../../lib/format';
import type { ShopFilterState } from './shopFilterState';

/** Filters other than search and category, counted on the Filters button. */
const sheetCount = (f: ShopFilterState) => (f.sort ? 1 : 0) + (f.kiloOnly ? 1 : 0); // standard-only has its own switch

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M3 5h14M6 10h8M8.5 15h3" strokeLinecap="round" />
    </svg>
  );
}

/** Bottom sheet on phones (centred card on wider screens): sort and the two switches. */
function FilterSheet({
  value,
  onChange,
  resultCount,
  onClose,
}: {
  value: ShopFilterState;
  onChange: (f: ShopFilterState) => void;
  resultCount: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // Older browsers without <dialog> modal support still show the sheet.
    const d = ref.current;
    if (d?.showModal) d.showModal();
    else d?.setAttribute('open', '');
  }, []);
  const close = () => (ref.current?.close ? ref.current.close() : onClose());
  return (
    <dialog
      ref={ref}
      aria-labelledby="shop-filter-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && close()}
      className="mx-auto mt-auto mb-0 max-h-[88dvh] w-full max-w-none animate-pop-in overflow-y-auto rounded-t-3xl border border-line bg-white p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-night/50 sm:m-auto sm:max-w-md sm:rounded-3xl"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-4">
        <h2 id="shop-filter-title" className="text-lg font-bold">
          {t('shopPage.filtersTitle')}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label={t('common.close')}
          className="grid h-11 w-11 place-items-center rounded-full text-xl text-muted hover:bg-ivory"
        >
          <span aria-hidden>×</span>
        </button>
      </div>

      <div className="space-y-6 px-5 py-5">
        <fieldset>
          <legend className="text-[13px] font-semibold text-muted">{t('shopPage.sortBy')}</legend>
          <div role="radiogroup" aria-label={t('shopPage.sortBy')} className="mt-2 grid gap-1">
            {(['', ...ITEM_SORTS] as const).map((s) => {
              const active = value.sort === s;
              return (
                <button
                  key={s || 'default'}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, sort: s })}
                  className={cx(
                    'flex min-h-12 items-center justify-between rounded-xl px-3 text-left text-[15px] transition',
                    active ? 'bg-brand-050 font-semibold text-plum' : 'hover:bg-ivory',
                  )}
                >
                  {s ? t(`shopPage.sort.${s}`) : t('shopPage.sortShop')}
                  <span
                    aria-hidden
                    className={cx(
                      'grid h-5 w-5 place-items-center rounded-full border-2',
                      active ? 'border-plum' : 'border-line-strong',
                    )}
                  >
                    {active && <span className="h-2.5 w-2.5 rounded-full bg-plum" />}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-[13px] font-semibold text-muted">{t('shopPage.show')}</legend>
          {(
            [
              ['kiloOnly', t('shopPage.kiloSales'), t('shopPage.kiloSalesHint')],
              ['standardOnly', t('shopPage.standardOnly'), t('shopPage.standardOnlyHint')],
            ] as const
          ).map(([key, label, hint]) => (
            <label
              key={key}
              className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 hover:bg-ivory"
            >
              <span>
                <span aria-hidden className="block text-[15px] font-semibold">
                  {label}
                </span>
                <span aria-hidden className="block text-sm text-muted">
                  {hint}
                </span>
              </span>
              <Toggle
                checked={value[key]}
                label={label}
                onChange={(v) => onChange({ ...value, [key]: v })}
              />
            </label>
          ))}
        </fieldset>
      </div>

      <div className="sticky bottom-0 flex gap-3 border-t border-line bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          type="button"
          variant="secondary"
          disabled={sheetCount(value) === 0}
          onClick={() => onChange({ ...value, sort: '', kiloOnly: false, standardOnly: false })}
        >
          {t('shopPage.clearFilters')}
        </Button>
        <Button type="button" className="flex-1" onClick={close}>
          {t('shopPage.showResults', { count: resultCount })}
        </Button>
      </div>
    </dialog>
  );
}

/**
 * Search, category chips and a Filters button — no dropdowns, so it works the same with thumbs
 * on any phone. Categories scroll sideways; sort and switches open in a bottom sheet.
 */
export function ShopFilters({
  categories,
  value,
  onChange,
  resultCount,
  sheetOpen,
  onSheet,
  extra,
}: {
  categories: Category[];
  value: ShopFilterState;
  onChange: (f: ShopFilterState) => void;
  resultCount: number;
  sheetOpen: boolean;
  onSheet: (open: boolean) => void;
  /** shown after the Filters button, e.g. the Standard only switch */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const count = sheetCount(value);
  const chips: { id: string; label: string }[] = [
    { id: '', label: t('shopPage.allCategories') },
    ...categories.map((c) => ({ id: c.id, label: categoryName(c) })),
  ];
  const active: { key: string; label: string; clear: Partial<ShopFilterState> }[] = [
    ...(value.sort
      ? [{ key: 'sort', label: t(`shopPage.sort.${value.sort}`), clear: { sort: '' as const } }]
      : []),
    ...(value.kiloOnly
      ? [{ key: 'kilo', label: t('shopPage.kiloSales'), clear: { kiloOnly: false } }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          >
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3 3" strokeLinecap="round" />
          </svg>
          <Input
            type="search"
            enterKeyHint="search"
            placeholder={t('shopPage.search')}
            aria-label={t('shopPage.search')}
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            className="mt-0 pl-9"
          />
        </div>
        <button
          type="button"
          onClick={() => onSheet(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={cx(
            'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition',
            count
              ? 'border-plum bg-brand-050 text-plum'
              : 'border-line-strong bg-white text-ink hover:bg-ivory',
          )}
        >
          <FilterIcon />
          <span className="sr-only sm:not-sr-only">{t('shopPage.filters')}</span>
          {count > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-plum px-1 text-xs text-white tabular-nums">
              {count}
            </span>
          )}
        </button>
        {extra}
      </div>

      <div
        role="radiogroup"
        aria-label={t('shopPage.categories')}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:px-0"
      >
        {chips.map((c) => {
          const on = value.cat === c.id;
          return (
            <button
              key={c.id || 'all'}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, cat: c.id })}
              className={cx(
                'min-h-10 shrink-0 rounded-full border px-4 text-[13px] font-semibold whitespace-nowrap transition',
                on
                  ? 'border-plum bg-plum text-white'
                  : 'border-line bg-white text-ink hover:bg-ivory',
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => onChange({ ...value, ...a.clear })}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-brand-050 px-3 text-xs font-semibold text-plum ring-1 ring-brand-100 ring-inset"
              aria-label={t('shopPage.removeFilter', { name: a.label })}
            >
              {a.label} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      {sheetOpen && (
        <FilterSheet
          value={value}
          onChange={onChange}
          resultCount={resultCount}
          onClose={() => onSheet(false)}
        />
      )}
    </div>
  );
}
