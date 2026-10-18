import { useTranslation } from 'react-i18next';

/** G8: shown on the pickup QR screen, the list QR and every bill. */
export function SafetyNotice() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="safety-notice"
      className="flex gap-3 rounded-2xl border border-saffron/30 bg-saffron/8 p-4 text-sm text-ink"
    >
      <span aria-hidden className="text-xl">
        🪔
      </span>
      <p className="font-semibold">{t('safety.notice')}</p>
    </div>
  );
}
