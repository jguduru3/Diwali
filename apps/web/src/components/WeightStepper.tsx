import { useTranslation } from 'react-i18next';
import { MAX_WEIGHT_GRAMS, WEIGHT_STEP_GRAMS, formatGrams } from '@pataka/shared';
import { cx } from './ui';

/** Weight in 250 g steps for items sold by weight. 0 = not added. */
export function WeightStepper({
  grams,
  onChange,
  name,
  disabled,
  max = MAX_WEIGHT_GRAMS,
}: {
  grams: number;
  onChange: (g: number) => void;
  name: string;
  disabled?: boolean;
  max?: number;
}) {
  const { t } = useTranslation();
  const step = WEIGHT_STEP_GRAMS;
  if (grams === 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(Math.min(1000, max))}
        aria-label={t('weight.add', { name })}
        className="inline-flex min-h-12 items-center gap-1.5 rounded-2xl bg-plum px-5 font-semibold text-white transition hover:bg-plum-2 active:scale-95 disabled:bg-line disabled:text-muted"
      >
        <span aria-hidden className="text-lg leading-none">
          +
        </span>{' '}
        {t('weight.addShort')}
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
        onClick={() => onChange(Math.max(0, grams - step))}
        aria-label={t('weight.less', { name })}
      >
        −
      </button>
      <span
        className="min-w-16 text-center font-display text-base font-semibold"
        aria-live="polite"
      >
        {formatGrams(grams)}
      </span>
      <button
        type="button"
        className={cx(btn, 'text-plum hover:bg-white/70')}
        onClick={() => onChange(Math.min(max, grams + step))}
        disabled={grams + step > max || disabled}
        aria-label={t('weight.more', { name })}
      >
        +
      </button>
    </div>
  );
}
