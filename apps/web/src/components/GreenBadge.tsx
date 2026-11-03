import { useTranslation } from 'react-i18next';
import type { GreenCert } from '@pataka/shared';
import { Badge } from './ui';

/** Shown only for products that carry a green certificate (optional, G7). */
export function GreenBadge({
  cert,
  reference,
}: {
  cert: GreenCert | null;
  reference?: string | null;
}) {
  const { t } = useTranslation();
  if (!cert) return null;
  return (
    <Badge tone="emerald" className="font-semibold">
      <span aria-hidden>🌿</span>
      {t(`greenCert.${cert}`)}
      {reference && (
        <span className="font-mono text-[10px] font-medium whitespace-nowrap opacity-70">
          {reference}
        </span>
      )}
    </Badge>
  );
}
