import { useTranslation } from 'react-i18next';
import { cx } from './ui';

export function DiyaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cx('h-10 w-10', className)}>
      <defs>
        <linearGradient id="dm-flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1c1" />
          <stop offset="0.55" stopColor="#f3b941" />
          <stop offset="1" stopColor="#ef7d3c" />
        </linearGradient>
        <linearGradient id="dm-lamp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5dc9a" />
          <stop offset="1" stopColor="#c8902f" />
        </linearGradient>
        <radialGradient id="dm-glow" cx="0.5" cy="0.4" r="0.5">
          <stop offset="0" stopColor="#f5dc9a" stopOpacity="0.6" />
          <stop offset="1" stopColor="#f5dc9a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="26" r="24" fill="url(#dm-glow)" />
      <path
        d="M32 8c6 9 8.5 14 8.5 18.5a8.5 8.5 0 0 1-17 0C23.5 22 26 17 32 8z"
        fill="url(#dm-flame)"
      />
      <path d="M12 37h40c0 9-9 16-20 16S12 46 12 37z" fill="url(#dm-lamp)" />
      <path d="M10 36h44" stroke="#f5dc9a" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-2.5">
      <DiyaMark />
      <span className="leading-none">
        <span className="block font-display text-xl font-semibold text-white sm:text-2xl">
          {t('app.name')}
        </span>
        {!compact && (
          <span className="mt-1 hidden text-[11px] font-semibold tracking-[0.2em] text-gold-light/80 uppercase sm:block">
            {t('app.city')}
          </span>
        )}
      </span>
    </span>
  );
}
