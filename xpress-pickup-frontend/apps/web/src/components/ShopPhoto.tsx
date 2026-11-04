import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * The shop entrance photo, shown with the shop's name so customers find the right shop.
 * Shops without one (or a photo that fails to load) get a quiet storefront tile.
 */
export function ShopPhoto({
  url,
  name,
  className,
}: {
  url: string | null | undefined;
  name: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={t('shopPhoto.alt', { name })}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cx('shrink-0 rounded-2xl bg-sand object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-2xl bg-brand-050 text-gold-deep',
        className,
      )}
    >
      <Icon icon={Store} className="h-1/3 w-1/3" />
    </span>
  );
}
