import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFeePaise } from '../lib/settings';
import { formatPaise } from '@pataka/shared';
import { Store, X } from 'lucide-react';
import { usePlanShops } from '../lib/planList';
import { Icon } from './Icon';

/**
 * Tells the customer, the moment their cart spans another store, that each store is its own
 * order with its own ₹30 platform fee (G3) — before they get to checkout.
 */
export function MultiShopFeeNotice() {
  const { t } = useTranslation();
  const count = usePlanShops().length;
  const fee = useFeePaise();
  const prev = useRef(count);
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (count > 1 && count > prev.current) setShown(count);
    if (count <= 1) setShown(null);
    prev.current = count;
  }, [count]);

  useEffect(() => {
    if (shown == null) return;
    const id = setTimeout(() => setShown(null), 8000);
    return () => clearTimeout(id);
  }, [shown]);

  if (shown == null) return null;
  return (
    <div className="no-print fixed inset-x-3 top-[calc(var(--header-h,4rem)+0.5rem)] z-40 mx-auto max-w-md">
      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-white p-4 shadow-[var(--shadow-lift)] motion-safe:animate-pop-in"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-050 text-plum">
          <Icon icon={Store} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-bold">{t('cart.multiTitle', { count: shown })}</p>
          <p className="mt-0.5 text-muted">
            {t('cart.multiBody', {
              fee: formatPaise(fee),
              total: formatPaise(fee * shown),
              count: shown,
            })}
          </p>
          <Link
            to="/cart"
            className="mt-1 inline-block font-semibold text-plum"
            onClick={() => setShown(null)}
          >
            {t('cart.reviewAll')}
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setShown(null)}
          aria-label={t('common.close')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-sand"
        >
          <Icon icon={X} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
