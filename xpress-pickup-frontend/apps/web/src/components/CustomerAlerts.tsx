import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOrdersNeedingAnswer } from '../lib/alerts';
import { BellRing } from 'lucide-react';
import { Icon } from './Icon';

/**
 * Banner on every customer screen while a shop waits for an answer, so a change made during
 * packing is seen at once rather than only when the order is opened.
 */
export function CustomerAlerts() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const waiting = useOrdersNeedingAnswer();
  const first = waiting[0];
  // The order page itself shows the questions.
  if (!first || pathname === `/orders/${first.id}`) return null;
  return (
    <div className="no-print border-b border-saffron/30 bg-saffron-bg">
      <Link
        to={`/orders/${first.id}`}
        className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 text-sm font-semibold text-saffron sm:px-6"
      >
        <Icon icon={BellRing} className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1">
          {waiting.length > 1
            ? t('alerts.manyNeedAnswer', { count: waiting.length })
            : t('alerts.needsAnswer', { shop: first.shopName })}
        </span>
        <span className="shrink-0 underline underline-offset-2">{t('alerts.answer')}</span>
      </Link>
    </div>
  );
}
