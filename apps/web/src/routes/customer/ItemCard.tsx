import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatGrams, formatPaise, type Item } from '@pataka/shared';
import { GreenBadge } from '../../components/GreenBadge';
import { QtyStepper } from '../../components/QtyStepper';
import { WeightStepper } from '../../components/WeightStepper';
import { Badge, Button, Card, cx } from '../../components/ui';
import { itemName } from '../../lib/format';
import type { usePlan } from '../../lib/planList';
import type { useWeights } from '../../lib/weightList';

type Plan = ReturnType<typeof usePlan>;
type Weights = ReturnType<typeof useWeights>;

/** One product: by the pack (count), by weight (₹/kg, 250 g steps), or a mix box of chosen items. */
export function ItemCard({
  item,
  all,
  plan,
  weights,
  onFull,
}: {
  item: Item;
  all: Item[];
  plan: Plan;
  weights: Weights;
  onFull: (full: boolean) => void;
}) {
  const { t } = useTranslation();
  const name = itemName(item);
  const qty = plan.qtyOf(item.itemNo);
  const weight = weights.get(item.id);
  const grams = weight?.grams ?? 0;
  const [choosing, setChoosing] = useState(false);
  const chosen = new Set(weight?.mixItemIds ?? []);
  const perKg = item.saleUnit !== 'pack';
  const lowStock = item.saleUnit === 'pack' ? 5 : 2000;
  const added = qty > 0 || grams > 0;

  const setWeight = (g: number, mix = weight?.mixItemIds) =>
    weights.set({ itemId: item.id, itemNo: item.itemNo, grams: g, mixItemIds: mix });

  const mixChoices = all.filter((i) => i.saleUnit !== 'mix_kg' && i.isActive && !i.isSoldOut);

  return (
    <Card
      as="li"
      className={cx(
        'p-4 transition',
        item.isSoldOut && 'opacity-60',
        added && 'ring-2 ring-gold/60',
      )}
    >
      <div className="flex items-center gap-4">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-line"
          />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sand to-gold-light/40 font-display text-lg font-semibold text-gold-deep">
            {item.saleUnit === 'mix_kg' ? '🎁' : `#${item.itemNo}`}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="leading-snug font-semibold">{name}</p>
          <p className="text-sm text-muted">{item.packDesc}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-semibold">
              {formatPaise(item.effectivePricePaise)}
              {perKg && <span className="text-sm font-normal text-muted">{t('weight.perKg')}</span>}
            </span>
            {item.effectivePricePaise < item.pricePaise && (
              <>
                <span className="text-sm text-muted line-through">
                  {formatPaise(item.pricePaise)}
                </span>
                <Badge tone="saffron">{t('shopPage.offer')}</Badge>
              </>
            )}
            {perKg && <Badge tone="plum">{t(`weight.unit.${item.saleUnit}`)}</Badge>}
            <GreenBadge cert={item.greenCert} />
            {item.isSoldOut && <Badge tone="muted">{t('shopPage.soldOut')}</Badge>}
            {!item.isSoldOut && item.stockQty != null && item.stockQty <= lowStock && (
              <Badge tone="danger">
                {item.saleUnit === 'pack'
                  ? t('shopPage.onlyLeft', { count: item.stockQty })
                  : t('weight.onlyLeft', { weight: formatGrams(item.stockQty) })}
              </Badge>
            )}
          </div>
        </div>
        {item.saleUnit === 'pack' && (
          <QtyStepper
            qty={qty}
            name={name}
            disabled={item.isSoldOut}
            onChange={(n) =>
              onFull(
                !plan.setQty(item.itemNo, item.stockQty != null ? Math.min(n, item.stockQty) : n),
              )
            }
          />
        )}
        {item.saleUnit === 'kg' && (
          <WeightStepper
            grams={grams}
            name={name}
            disabled={item.isSoldOut}
            max={item.stockQty ?? undefined}
            onChange={(g) => setWeight(g)}
          />
        )}
        {item.saleUnit === 'mix_kg' && !choosing && (
          <Button
            variant={grams ? 'secondary' : 'dark'}
            disabled={item.isSoldOut}
            onClick={() => setChoosing(true)}
          >
            {grams ? formatGrams(grams) : t('weight.chooseMix')}
          </Button>
        )}
      </div>

      {item.saleUnit === 'mix_kg' && (choosing || grams > 0) && (
        <div className="mt-4 border-t border-line/70 pt-4">
          <p className="text-sm font-semibold">{t('weight.mixHelp')}</p>
          <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            {mixChoices.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-sand/60">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-plum"
                    checked={chosen.has(c.id)}
                    onChange={() => {
                      const next = new Set(chosen);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      const ids = [...next];
                      if (grams > 0 || ids.length)
                        setWeight(ids.length ? Math.max(grams, 1000) : 0, ids);
                    }}
                  />
                  <span className="text-sm">{itemName(c)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">{t('weight.mixWeight')}</span>
            <WeightStepper
              grams={grams}
              name={name}
              disabled={!chosen.size}
              onChange={(g) => setWeight(g)}
            />
          </div>
          {grams > 0 && (
            <p className="mt-2 text-right text-sm font-semibold">
              ≈ {formatPaise(Math.round((item.effectivePricePaise * grams) / 1000))}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
