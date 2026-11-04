import { useTranslation } from 'react-i18next';
import { BadgeCheck } from 'lucide-react';
import { useStandardMode } from '../lib/standardMode';
import { Icon } from './Icon';
import { cx } from './ui';

/** The "Standard only" switch: shows only certified standard products, in every shop. */
export function StandardToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [on, setOn] = useStandardMode();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t('shopPage.standardOnly')}
      title={t('shopPage.standardOnlyHint')}
      onClick={() => setOn(!on)}
      className={cx(
        'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-2.5 text-[13px] font-bold transition',
        on ? 'border-emerald bg-emerald-soft text-emerald' : 'border-line bg-white text-ink',
        className,
      )}
    >
      <Icon icon={BadgeCheck} className="hidden h-4 w-4 sm:block" />
      <span>{t('shopPage.standardShort')}</span>
      <span
        aria-hidden
        className={cx(
          'relative h-5 w-9 rounded-full transition-colors',
          on ? 'bg-emerald' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]',
            on ? 'left-[1.125rem]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
