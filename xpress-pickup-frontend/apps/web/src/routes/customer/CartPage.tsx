import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFeePaise } from '../../lib/settings';
import { formatPaise } from '@pataka/shared';
import { useMe } from '../../auth/useAuth';
import { ErrorText } from '../../components/ErrorText';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  PageTitle,
} from '../../components/ui';
import { itemName } from '../../lib/format';
import { setPayQueue, type QueuedFee } from '../../lib/payQueue';
import { clearPlan, usePlan, usePlanShops } from '../../lib/planList';
import { useOrderingInfo, usePlaceOrder, useShop, useShopItems } from '../../lib/queries';
import { usePlanDetails } from './usePlanDetails';
import { ShoppingBag } from 'lucide-react';
import { Icon } from '../../components/Icon';

type Summary = {
  name: string;
  total: number;
  unavailable: number;
  lines: { itemId: string; qty: number }[];
};

/** One shop's list in the cart; reports its totals up so the cart can add them. */
function CartShop({
  code,
  onSummary,
}: {
  code: string;
  onSummary: (code: string, s: Summary) => void;
}) {
  const { t } = useTranslation();
  const shop = useShop(code);
  const items = useShopItems(code);
  // Subscribes, so the row updates when its list changes.
  const { lines } = usePlan(code, undefined);
  const { rows, total, unavailable } = usePlanDetails(lines, items.data);
  const fee = useFeePaise();
  const name = shop.data?.name ?? code;
  const ready = !!items.data && !!shop.data;
  const lineKey = rows.map((r) => `${r.itemNo}x${r.qty}`).join(',');
  useEffect(() => {
    if (!ready) return;
    onSummary(code, {
      name,
      total,
      unavailable,
      lines: rows.filter((r) => r.item).map((r) => ({ itemId: r.item!.id, qty: r.qty })),
    });
    // rows is summarised by lineKey; re-report only when what the cart shows changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, code, name, total, unavailable, lineKey, onSummary]);

  return (
    <Card as="li" className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/s/${code}`} className="text-lg font-bold hover:text-plum">
            {name}
          </Link>
          <p className="text-sm text-muted">{shop.data?.area}</p>
        </div>
        <p className="shrink-0 font-display text-xl font-bold">{formatPaise(total)}</p>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.itemNo} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {r.qty} × {r.item ? itemName(r.item) : t('plan.unknownItem', { no: r.itemNo })}
            </span>
            {r.item?.isSoldOut ? (
              <Badge tone="danger">{t('shopPage.soldOut')}</Badge>
            ) : (
              <span className="shrink-0 tabular-nums">{formatPaise(r.lineTotal)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
        <span className="text-xs font-semibold text-muted">
          {t('cart.feeForShop', { fee: formatPaise(fee) })}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => clearPlan(code)}>
            {t('cart.remove')}
          </Button>
          <ButtonLink to={`/s/${code}/plan`} variant="secondary" size="sm">
            {t('cart.edit')}
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}

/**
 * /cart — every shop's list together. Each shop gets its own order and its own ₹30 fee,
 * so n shops cost n × ₹30 and one shop costs ₹30 (G3: flat fee per order, no commission).
 * Orders are placed one by one (the server prices each; G11), then the fees are paid in turn.
 */
export function CartPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const codes = usePlanShops();
  const { data: me } = useMe();
  const ordering = useOrderingInfo();
  const place = usePlaceOrder();
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(0);
  const feePaise = useFeePaise();
  const onSummary = useCallback(
    (code: string, s: Summary) => setSummaries((m) => ({ ...m, [code]: s })),
    [],
  );

  if (!codes.length) {
    return (
      <EmptyState
        icon={<Icon icon={ShoppingBag} className="h-6 w-6" />}
        title={t('plan.emptyTitle')}
        body={t('cart.emptyBody')}
        action={<ButtonLink to="/">{t('plan.browse')}</ButtonLink>}
      />
    );
  }

  const known = codes.map((c) => summaries[c]).filter(Boolean) as Summary[];
  const allKnown = known.length === codes.length;
  const atShops = known.reduce((n, s) => n + s.total, 0);
  const unavailable = known.reduce((n, s) => n + s.unavailable, 0);
  const n = codes.length;

  const placeAll = async () => {
    setPlacing(true);
    setPlaced(0);
    const queue: QueuedFee[] = [];
    let firstOrderId: string | null = null;
    try {
      for (const code of codes) {
        const s = summaries[code]!;
        const order = await place.mutateAsync({ shopCode: code, lines: s.lines });
        clearPlan(code);
        firstOrderId ??= order.id;
        if (order.fee.checkout)
          queue.push({ orderId: order.id, shopName: s.name, url: order.fee.checkout.url });
        setPlaced((p) => p + 1);
      }
    } finally {
      setPlacing(false);
    }
    setPayQueue(queue);
    if (queue[0]) navigate(queue[0].url);
    else navigate(firstOrderId ? `/orders/${firstOrderId}` : '/orders');
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <PageTitle title={t('cart.title')} subtitle={t('cart.subtitle', { count: n })} />
        <ul className="space-y-3">
          {codes.map((c) => (
            <CartShop key={c} code={c} onSummary={onSummary} />
          ))}
        </ul>
        <ButtonLink to="/" variant="secondary" className="mt-4">
          + {t('cart.addShop')}
        </ButtonLink>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-[calc(var(--header-h,8rem)+1rem)] lg:self-start">
        <Card className="p-5 sm:p-6">
          <dl className="divide-y divide-line rounded-2xl border border-line">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <dt className="text-sm font-semibold">
                {t('cart.payNow', { count: n, fee: formatPaise(feePaise) })}
              </dt>
              <dd className="font-display text-xl font-bold text-plum">
                {formatPaise(feePaise * n)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <dt className="text-sm font-semibold">{t('cart.payAtShops', { count: n })}</dt>
              <dd className="font-display text-2xl font-bold">{formatPaise(atShops)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">{t('cart.oneFeePerShop')}</p>
          {unavailable > 0 && (
            <Notice tone="danger" className="mt-4">
              {t('plan.unavailable', { count: unavailable })}
            </Notice>
          )}
          <div className="mt-5 grid gap-3">
            {ordering.data?.enabled === false ? (
              <Notice>{t('plan.orderingOff')}</Notice>
            ) : !me ? (
              <ButtonLink to={`/login?next=${encodeURIComponent('/cart')}`} size="lg">
                {t('plan.signInToOrder')}
              </ButtonLink>
            ) : (
              <>
                <Button
                  size="lg"
                  onClick={() => void placeAll()}
                  disabled={placing || !allKnown || unavailable > 0 || !ordering.data}
                >
                  {placing
                    ? t('cart.placing', { done: placed, count: n })
                    : t('cart.placeAll', { count: n, fee: formatPaise(feePaise * n) })}
                </Button>
                <p className="text-xs text-muted">
                  {t('plan.feeNote', { fee: formatPaise(feePaise) })}
                </p>
                <ErrorText error={place.error} />
                {place.error && placed > 0 && (
                  <Notice>{t('cart.partlyPlaced', { count: placed })}</Notice>
                )}
              </>
            )}
          </div>
          <p className="mt-4 text-xs text-muted">{t('plan.finalNote')}</p>
        </Card>
      </aside>
    </div>
  );
}
