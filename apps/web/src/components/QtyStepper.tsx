import { useTranslation } from 'react-i18next';
import { MAX_LINE_QTY } from '@pataka/shared';
import { cx } from './ui';

export function QtyStepper({
  qty,
  onChange,
  name,
  disabled,
}: {
  qty: number;
  onChange: (q: number) => void;
  name: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (qty === 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(1)}
        aria-label={t('shopPage.add', { name })}
        className="inline-flex min-h-9 items-center gap-1 rounded-full border border-plum bg-white px-4 text-[13px] font-bold tracking-wide text-plum uppercase transition hover:bg-brand-050 active:scale-95 disabled:border-line disabled:bg-ivory disabled:text-muted"
      >
        <span aria-hidden className="text-lg leading-none">
          +
        </span>{' '}
        {t('shopPage.addShort')}
      </button>
    );
  }
  const btn =
    'grid h-9 w-9 place-items-center rounded-full text-lg font-bold transition active:scale-90 disabled:opacity-40';
  return (
    <div className="inline-flex items-center rounded-full bg-plum text-white">
      <button
        type="button"
        className={cx(btn, 'hover:bg-white/15')}
        onClick={() => onChange(qty - 1)}
        aria-label={t('shopPage.less', { name })}
      >
        −
      </button>
      <span className="min-w-7 text-center font-display text-base font-bold" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        className={cx(btn, 'hover:bg-white/15')}
        onClick={() => onChange(qty + 1)}
        disabled={qty >= MAX_LINE_QTY || disabled}
        aria-label={t('shopPage.more', { name })}
      >
        +
      </button>
    </div>
  );
}
