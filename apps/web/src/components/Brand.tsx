import { useTranslation } from 'react-i18next';
import { cx } from './ui';

export function DiyaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cx('h-8 w-8 sm:h-10 sm:w-10', className)}>
      <path d="M32 8c6 9 8.5 14 8.5 18.5a8.5 8.5 0 0 1-17 0C23.5 22 26 17 32 8z" fill="#e4d8ff" />
      <path d="M12 37h40c0 9-9 16-20 16S12 46 12 37z" fill="#b798f5" />
      <path d="M10 36h44" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-2.5">
      <DiyaMark />
      <span className="leading-none">
        <span className="block font-display text-lg font-extrabold tracking-tight whitespace-nowrap text-white sm:text-2xl">
          {t('app.name')}
        </span>
        {!compact && (
          <span className="mt-1 hidden text-[11px] font-semibold tracking-[0.14em] text-gold-light uppercase sm:block">
            {t('app.city')}
          </span>
        )}
      </span>
    </span>
  );
}
