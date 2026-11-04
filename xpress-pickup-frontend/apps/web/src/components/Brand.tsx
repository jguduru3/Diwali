import { useTranslation } from 'react-i18next';

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center">
      <span className="min-w-0 leading-none">
        <span className="block truncate font-display text-base font-extrabold tracking-tight text-white sm:hidden">
          {t('app.shortName')}
        </span>
        <span className="hidden font-display text-2xl font-extrabold tracking-tight whitespace-nowrap text-white sm:block">
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
