import { useTranslation } from 'react-i18next';
import { formatPaise, type OrderLine } from '@pataka/shared';
import { itemName } from '../lib/format';
import { Badge, cx } from './ui';

export type OrderLineView = Pick<
  OrderLine,
  | 'itemNo'
  | 'nameEn'
  | 'nameTe'
  | 'nameHi'
  | 'packDesc'
  | 'imageUrl'
  | 'qty'
  | 'unitPricePaise'
  | 'status'
>;

/** One item of an order: photo, name, pack and pickup status on the left; line total on the right.
 *  `compact` is the denser row used on the My orders list. */
export function OrderLineRow({
  line: l,
  compact = false,
}: {
  line: OrderLineView;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const tile = compact ? 'h-10 w-10 rounded-lg text-sm' : 'h-12 w-12 rounded-xl';
  return (
    <li className={cx('flex items-center gap-3', compact ? 'py-2.5' : 'py-3')}>
      {l.imageUrl ? (
        <img src={l.imageUrl} alt="" className={cx('shrink-0 object-cover', tile)} />
      ) : (
        <span
          className={cx(
            'grid shrink-0 place-items-center bg-sand font-semibold text-gold-deep',
            tile,
          )}
        >
          #{l.itemNo}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cx('font-semibold', compact && 'truncate')}>{itemName(l)}</p>
        <div className={cx(compact && 'flex flex-wrap items-center gap-x-2 gap-y-1')}>
          <p className="text-sm text-muted">
            {l.qty} × {formatPaise(l.unitPricePaise)} {l.packDesc && `· ${l.packDesc}`}
          </p>
          <Badge
            className={compact ? undefined : 'mt-1'}
            tone={l.status === 'picked' ? 'emerald' : l.status === 'pending' ? 'muted' : 'saffron'}
          >
            {t(`lineStatus.${l.status}`)}
          </Badge>
        </div>
      </div>
      <span
        className={cx(
          'shrink-0 text-right font-display font-semibold',
          compact ? 'text-base' : 'text-lg',
        )}
      >
        {formatPaise(l.unitPricePaise * l.qty)}
      </span>
    </li>
  );
}
