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
        className="inline-flex min-h-12 items-center gap-1.5 rounded-2xl bg-plum px-5 font-semibold text-white transition hover:bg-plum-2 active:scale-95 disabled:bg-line disabled:text-muted"
      >
        <span aria-hidden className="text-lg leading-none">
          +
        </span>{' '}
        {t('shopPage.addShort')}
      </button>
    );
  }
  const btn =
    'grid h-12 w-12 place-items-center rounded-2xl text-xl font-bold transition active:scale-90 disabled:opacity-40';
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl bg-gold-light/40 p-0.5 ring-1 ring-gold/40">
      <button
        type="button"
        className={cx(btn, 'text-plum hover:bg-white/70')}
        onClick={() => onChange(qty - 1)}
        aria-label={t('shopPage.less', { name })}
      >
        −
      </button>
      <span className="min-w-8 text-center font-display text-lg font-semibold" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        className={cx(btn, 'text-plum hover:bg-white/70')}
        onClick={() => onChange(qty + 1)}
        disabled={qty >= MAX_LINE_QTY || disabled}
        aria-label={t('shopPage.more', { name })}
      >
        +
      </button>
    </div>
  );
}
