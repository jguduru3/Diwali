import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatGrams,
  formatPaise,
  GREEN_CERTS,
  rupeesToPaise,
  SALE_UNITS,
  type Category,
  type GreenCert,
  type Item,
  type SaleUnit,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { GreenBadge } from '../../components/GreenBadge';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
  Toggle,
  cx,
} from '../../components/ui';
import { categoryName, itemName } from '../../lib/format';
import { photoToJpegBase64 } from '../../lib/image';
import {
  useCreateItem,
  useItemImage,
  useOwnItems,
  usePatchItem,
  useShopContext,
  useSoldOut,
} from '../../lib/queries';

type Draft = {
  categoryId: string;
  nameEn: string;
  nameTe: string;
  packDesc: string;
  price: string;
  greenCert: GreenCert;
  greenRef: string;
  rackCode: string;
  saleUnit: SaleUnit;
  offer: string;
  offerEnds: string;
  barcode: string;
  stock: string;
};

/** What the form produces, besides the draft strings. */
type Parsed = {
  pricePaise: number;
  offerPricePaise: number | null;
  offerEndsAt: string | null;
  stockQty: number | null;
};

const emptyDraft = (cats: Category[]): Draft => ({
  categoryId: cats.find((c) => !c.isBanned)?.id ?? '',
  nameEn: '',
  nameTe: '',
  packDesc: '',
  price: '',
  greenCert: 'CSIR_NEERI_SWAS',
  greenRef: '',
  rackCode: '',
  saleUnit: 'pack',
  offer: '',
  offerEnds: '',
  barcode: '',
  stock: '',
});

/** "2026-11-08T22:00" (IST wall clock from the input) → ISO instant. */
const istLocalToIso = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
const isoToIstLocal = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16) : '';

function ItemForm({
  categories,
  initial,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  categories: Category[];
  initial: Draft;
  onSubmit: (d: Draft, parsed: Parsed) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(initial);
  const [priceErr, setPriceErr] = useState(false);
  const [offerErr, setOfferErr] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD({ ...d, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(d.price);
    const offer = d.offer.trim() ? rupeesToPaise(d.offer) : null;
    const badOffer = d.offer.trim() !== '' && (!offer || (!!paise && offer >= paise));
    setPriceErr(!paise);
    setOfferErr(badOffer);
    if (paise && !badOffer) {
      onSubmit(d, {
        pricePaise: paise,
        offerPricePaise: offer,
        offerEndsAt: offer ? istLocalToIso(d.offerEnds) : null,
        stockQty: d.stock.trim() === '' ? null : Math.max(0, Math.floor(Number(d.stock))),
      });
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label={t('prices.nameEn')}>
        <Input required minLength={2} value={d.nameEn} onChange={set('nameEn')} />
      </Field>
      <Field label={t('prices.nameTe')}>
        <Input value={d.nameTe} onChange={set('nameTe')} lang="te" />
      </Field>
      <Field label={t('prices.category')} hint={t('prices.bannedHint')}>
        <Select required value={d.categoryId} onChange={set('categoryId')}>
          {categories
            .filter((c) => !c.isBanned)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {categoryName(c)}
              </option>
            ))}
        </Select>
      </Field>
      <Field
        label={t('weight.soldBy')}
        hint={d.saleUnit !== 'pack' ? t('weight.soldByHint') : undefined}
      >
        <Select value={d.saleUnit} onChange={set('saleUnit')}>
          {SALE_UNITS.map((u) => (
            <option key={u} value={u}>
              {t(`weight.unit.${u}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('prices.pack')}>
        <Input value={d.packDesc} onChange={set('packDesc')} placeholder="10 pcs" />
      </Field>
      <Field label={d.saleUnit === 'pack' ? t('prices.price') : t('weight.pricePerKg')}>
        <Input
          required
          inputMode="decimal"
          value={d.price}
          onChange={set('price')}
          placeholder="₹"
          aria-invalid={priceErr}
        />
      </Field>
      <Field label={t('prices.offer')} hint={t('prices.offerHint')}>
        <Input
          inputMode="decimal"
          value={d.offer}
          onChange={set('offer')}
          placeholder="₹"
          aria-invalid={offerErr}
        />
      </Field>
      <Field label={t('prices.offerEnds')}>
        <Input
          type="datetime-local"
          value={d.offerEnds}
          onChange={set('offerEnds')}
          disabled={!d.offer.trim()}
        />
      </Field>
      <Field label={t('prices.barcode')} hint={t('prices.barcodeHint')}>
        <Input
          value={d.barcode}
          onChange={set('barcode')}
          inputMode="numeric"
          pattern="[0-9A-Za-z\-]{4,32}"
          maxLength={32}
        />
      </Field>
      <Field
        label={d.saleUnit === 'pack' ? t('prices.stock') : t('weight.stockGrams')}
        hint={t('prices.stockHint')}
      >
        <Input type="number" min={0} value={d.stock} onChange={set('stock')} />
      </Field>
      <Field label={t('prices.rack')} hint={t('prices.rackHint')}>
        <Input value={d.rackCode} onChange={set('rackCode')} placeholder="B3" maxLength={10} />
      </Field>
      <Field label={t('prices.cert')}>
        <Select value={d.greenCert} onChange={set('greenCert')}>
          {GREEN_CERTS.map((c) => (
            <option key={c} value={c}>
              {t(`greenCert.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('prices.certRef')} hint={t('prices.certRefHint')}>
        <Input required minLength={2} value={d.greenRef} onChange={set('greenRef')} />
      </Field>
      <div className="space-y-3 sm:col-span-2">
        {priceErr && <p className="text-sm text-danger">{t('prices.priceInvalid')}</p>}
        {offerErr && <p className="text-sm text-danger">{t('prices.offerInvalid')}</p>}
        <ErrorText error={error} />
        <div className="flex gap-3">
          <Button disabled={busy}>{t('common.save')}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </form>
  );
}

const toDraft = (i: Item): Draft => ({
  categoryId: i.categoryId,
  nameEn: i.nameEn,
  nameTe: i.nameTe ?? '',
  packDesc: i.packDesc ?? '',
  price: String(i.pricePaise / 100),
  greenCert: i.greenCert,
  greenRef: i.greenRef,
  rackCode: i.rackCode ?? '',
  saleUnit: i.saleUnit,
  offer: i.offerPricePaise ? String(i.offerPricePaise / 100) : '',
  offerEnds: isoToIstLocal(i.offerEndsAt),
  barcode: i.barcode ?? '',
  stock: i.stockQty == null ? '' : String(i.stockQty),
});

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

const toBody = (d: Draft, p: Parsed) => ({
  categoryId: d.categoryId,
  nameEn: d.nameEn.trim(),
  nameTe: opt(d.nameTe),
  packDesc: opt(d.packDesc),
  pricePaise: p.pricePaise,
  saleUnit: d.saleUnit,
  offerPricePaise: p.offerPricePaise,
  offerEndsAt: p.offerEndsAt,
  barcode: d.barcode.trim() || null,
  stockQty: p.stockQty,
  greenCert: d.greenCert,
  greenRef: d.greenRef.trim(),
  rackCode: opt(d.rackCode),
});

function PhotoButton({ item }: { item: Item }) {
  const { t } = useTranslation();
  const upload = useItemImage();
  const [tooBig, setTooBig] = useState(false);
  return (
    <span>
      <label className="inline-flex min-h-10 cursor-pointer items-center rounded-2xl px-3 text-sm font-semibold text-plum hover:bg-plum/5">
        📷 {upload.isPending ? t('common.loading') : t('prices.uploadPhoto')}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={upload.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const base64 = await photoToJpegBase64(file, 900);
            const big = base64.length > 2_600_000;
            setTooBig(big);
            if (!big) upload.mutate({ id: item.id, image: { contentType: 'image/jpeg', base64 } });
          }}
        />
      </label>
      {tooBig && <span className="text-xs text-danger">{t('prices.photoTooBig')}</span>}
      <ErrorText error={upload.error} />
    </span>
  );
}

/** Products: owners edit photos, prices, offers, barcodes and stock; staff and packers toggle sold-out. */
export function Prices() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const items = useOwnItems();
  const create = useCreateItem();
  const patch = usePatchItem();
  const soldOut = useSoldOut();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = !!ctx.data?.canEdit;

  if (items.isPending) return <Spinner label={t('common.loading')} />;
  if (items.error) return <ErrorText error={items.error} />;
  const cats = items.data.categories;
  const catById = new Map(cats.map((c) => [c.id, c]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          {t('prices.summary', {
            count: items.data.items.filter((i) => i.isActive).length,
            version: items.data.priceVersion,
          })}
        </p>
        {canEdit && !adding && <Button onClick={() => setAdding(true)}>+ {t('prices.add')}</Button>}
      </div>
      {!canEdit && <Notice>{t('prices.staffNote')}</Notice>}

      {adding && (
        <Card className="p-6">
          <h2 className="mb-4 text-xl font-semibold">{t('prices.add')}</h2>
          <ItemForm
            categories={cats}
            initial={emptyDraft(cats)}
            busy={create.isPending}
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(d, p) => create.mutate(toBody(d, p), { onSuccess: () => setAdding(false) })}
          />
        </Card>
      )}

      <ul className="space-y-3">
        {items.data.items.map((item) => (
          <Card as="li" key={item.id} className={cx('p-4', !item.isActive && 'opacity-60')}>
            {editing === item.id ? (
              <ItemForm
                categories={cats}
                initial={toDraft(item)}
                busy={patch.isPending}
                error={patch.error}
                onCancel={() => setEditing(null)}
                onSubmit={(d, p) =>
                  patch.mutate(
                    { id: item.id, patch: toBody(d, p) },
                    { onSuccess: () => setEditing(null) },
                  )
                }
              />
            ) : (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-line"
                    />
                  ) : (
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sand font-display font-semibold text-gold-deep">
                      #{item.itemNo}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold">{itemName(item)}</p>
                      <span className="shrink-0 text-right">
                        <span className="font-display text-xl font-semibold">
                          {formatPaise(item.effectivePricePaise)}
                          {item.saleUnit !== 'pack' && (
                            <span className="text-sm font-normal text-muted">
                              {t('weight.perKg')}
                            </span>
                          )}
                        </span>
                        {item.effectivePricePaise < item.pricePaise && (
                          <span className="ml-2 text-sm text-muted line-through">
                            {formatPaise(item.pricePaise)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span>
                        {catById.get(item.categoryId)
                          ? categoryName(catById.get(item.categoryId)!)
                          : ''}
                        {item.packDesc && ` · ${item.packDesc}`}
                      </span>
                      {item.rackCode && (
                        <Badge tone="muted">{t('counter.rack', { rack: item.rackCode })}</Badge>
                      )}
                      <GreenBadge cert={item.greenCert} reference={item.greenRef} />
                      {item.barcode && <Badge tone="muted">▥ {item.barcode}</Badge>}
                      {item.saleUnit !== 'pack' && (
                        <Badge tone="plum">{t(`weight.unit.${item.saleUnit}`)}</Badge>
                      )}
                      {item.stockQty != null && (
                        <Badge
                          tone={
                            item.stockQty <= (item.saleUnit === 'pack' ? 5 : 2000)
                              ? 'danger'
                              : 'muted'
                          }
                        >
                          {item.saleUnit === 'pack'
                            ? t('prices.left', { count: item.stockQty })
                            : t('weight.left', { weight: formatGrams(item.stockQty) })}
                        </Badge>
                      )}
                      {item.effectivePricePaise < item.pricePaise && (
                        <Badge tone="saffron">{t('shopPage.offer')}</Badge>
                      )}
                      {!item.isActive && <Badge tone="muted">{t('prices.hidden')}</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-3 lg:justify-end lg:border-0 lg:pt-0">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <Toggle
                      checked={!item.isSoldOut}
                      label={t('prices.soldOutToggle', { name: item.nameEn })}
                      disabled={soldOut.isPending}
                      onChange={(inStock) => soldOut.mutate({ id: item.id, isSoldOut: !inStock })}
                    />
                    <span className={item.isSoldOut ? 'text-danger' : 'text-muted'}>
                      {item.isSoldOut ? t('shopPage.soldOut') : t('prices.inStock')}
                    </span>
                  </label>
                  {canEdit && (
                    <span className="flex flex-wrap items-center gap-1">
                      <PhotoButton item={item} />
                      <Button size="sm" variant="secondary" onClick={() => setEditing(item.id)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          patch.mutate({ id: item.id, patch: { isActive: !item.isActive } })
                        }
                      >
                        {item.isActive ? t('prices.hide') : t('prices.show')}
                      </Button>
                    </span>
                  )}
                </div>
              </div>
            )}
          </Card>
        ))}
      </ul>
      <ErrorText error={soldOut.error} />
    </div>
  );
}
