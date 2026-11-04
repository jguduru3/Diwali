import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '@pataka/shared';
import { cx } from './ui';

const accent: Record<OrderStatus, string> = {
  fee_pending: 'bg-muted/40',
  placed: 'bg-brand',
  confirmed: 'bg-plum-3',
  packing: 'bg-plum-3',
  awaiting_customer: 'bg-saffron',
  packed: 'bg-emerald',
  completed: 'bg-emerald',
  cancelled: 'bg-line',
  rejected: 'bg-danger/60',
  expired: 'bg-line',
};

/** The colour band along the top of an order card, matching its status. */
export function OrderAccent({ status }: { status: OrderStatus }) {
  return <div aria-hidden className={cx('h-1.5', accent[status])} />;
}

const STEPS = ['placed', 'confirmed', 'packing', 'packed', 'completed'] as const;
const stepOf: Partial<Record<OrderStatus, number>> = {
  fee_pending: -1,
  placed: 0,
  confirmed: 1,
  packing: 2,
  awaiting_customer: 2,
  packed: 3,
  completed: 4,
};

/** Placed → Confirmed → Packing → Ready → Collected, with the current step highlighted. */
export function OrderTracker({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const at = stepOf[status];
  if (at === undefined) return null;
  return (
    <ol className="grid grid-cols-5">
      {STEPS.map((step, i) => {
        const done = i <= at;
        const current = i === at;
        return (
          <li
            key={step}
            aria-current={current ? 'step' : undefined}
            className="relative flex flex-col items-center gap-1.5 text-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cx(
                  'absolute top-[7px] right-1/2 h-0.5 w-full',
                  done ? 'bg-plum-3' : 'bg-line',
                )}
              />
            )}
            <span
              aria-hidden
              className={cx(
                'relative grid h-4 w-4 place-items-center rounded-full ring-4 ring-white',
                current ? 'bg-brand' : done ? 'bg-plum-3' : 'bg-line',
              )}
            >
              {done && !current && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white">
                  <path
                    d="m2.5 6.2 2.3 2.3 4.7-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span
              className={cx(
                'text-[11px] leading-tight font-semibold sm:text-xs',
                current ? 'text-ink' : done ? 'text-plum-3' : 'text-muted',
              )}
            >
              {t(`order.track.${step}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The shop's initial in a plum tile: a quick visual anchor for which shop an order is from. */
export function ShopBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-night font-display text-lg font-extrabold text-white',
        className,
      )}
    >
      {name.charAt(0)}
    </span>
  );
}
