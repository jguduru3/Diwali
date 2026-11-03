import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPaise,
  GREEN_CERTS,
  kiloUnitPaise,
  rupeesToPaise,
  type Category,
  type GreenCert,
  type Item,
  type ItemKind,
  KIT_TYPES,
  type KitType,
  type SaleMode,
} from '@pataka/shared';
import { Barcode, BarcodeLabelDialog } from '../../components/BarcodeLabel';
import { ErrorText } from '../../components/ErrorText';
import { GreenBadge } from '../../components/GreenBadge';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Segmented,
  Select,
  Spinner,
  Toggle,
  cx,
} from '../../components/ui';
import { categoryName, formatWeight, itemName } from '../../lib/format';
import { photoToJpegBase64 } from '../../lib/image';
import { checkPhoto, type PhotoIssue } from '../../lib/photoQuality';
import { PhotoAdvice } from '../../components/FilePicker';
import {
  useCreateItem,
  useItemImage,
  useOwnItems,
  usePatchItem,
  useRemoveItem,
  useShopContext,
  useSoldOut,
} from '../../lib/queries';
import { Camera } from 'lucide-react';
import { Icon } from '../../components/Icon';

type Draft = {
  categoryId: string;
  nameEn: string;
  nameTe: string;
  nameHi: string;
  packDesc: string;
  /** always one of the two; the switch has no "none" position */
  saleMode: SaleMode;
  /** MRP sale: price and offer per pack */
  price: string;
  offer: string;
  /** kilo sale: rate and offer rate per kg, and the weight of one pack */
  perKg: string;
  offerPerKg: string;
  weight: string;
  weightUnit: 'g' | 'kg';
  offerEnds: string;
  /** optional: '' = no green certificate */
  greenCert: GreenCert | '';
  greenRef: string;
  /** a kit is one product made of several items */
  kind: ItemKind;
  kitType: KitType;
  contents: { name: string; qty: string }[];
  rackCode: string;
  /** optional: the barcode printed on the box, instead of the generated one */
  boxBarcode: string;
  /** edit: ask the server for a new store barcode */
  newBarcode: boolean;
  stock: string;
  isRecommended: boolean;
  isPopular: boolean;
  isStandard: boolean;
};

const TAGS = ['isRecommended', 'isPopular', 'isStandard'] as const;

/** What the form produces, besides the draft strings. */
type Parsed = {
  pricePaise: number | null;
  offerPricePaise: number | null;
  pricePerKgPaise: number | null;
  offerPricePerKgPaise: number | null;
  weightGrams: number | null;
  offerEndsAt: string | null;
  stockQty: number | null;
};

const emptyDraft = (cats: Category[]): Draft => ({
  categoryId: cats.find((c) => !c.isBanned)?.id ?? '',
  nameEn: '',
  nameTe: '',
  nameHi: '',
  packDesc: '',
  saleMode: 'mrp',
  price: '',
  offer: '',
  perKg: '',
  offerPerKg: '',
  weight: '',
  weightUnit: 'g',
  offerEnds: '',
  greenCert: '',
  greenRef: '',
  kind: 'product',
  kitType: 'family',
  contents: [{ name: '', qty: '1' }],
  rackCode: '',
  boxBarcode: '',
  newBarcode: false,
  stock: '',
  isRecommended: false,
  isPopular: false,
  isStandard: false,
});

/**
 * "500" with g → 500 grams, "1.5" with kg → 1500. A unit typed in the box ("500 g", "1kg",
 * "2 KG") wins over the picker. Null unless a positive weight up to 100 kg.
 */
const toGrams = (v: string, unit: 'g' | 'kg') => {
  const m = /^(\d+(?:[.,]\d+)?)\s*(g|gm|gms|grams?|kg|kgs|kilos?)?$/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const typed = m[2]?.toLowerCase();
  const kg = typed ? typed.startsWith('k') : unit === 'kg';
  const g = Math.round(kg ? n * 1000 : n);
  return g > 0 && g <= 100_000 ? g : null;
};

/** "2026-11-08T22:00" (IST wall clock from the input) → ISO instant. */
const istLocalToIso = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
const isoToIstLocal = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16) : '';

type Errors = Partial<Record<'price' | 'offer' | 'weight', string>>;

/** Pure: checks the draft for its sale mode and returns the numbers, or the errors to show. */
function parseDraft(d: Draft, t: (k: string) => string): { parsed?: Parsed; errors: Errors } {
  const errors: Errors = {};
  const optional = (v: string) => (v.trim() ? rupeesToPaise(v) : null);
  const stockQty = d.stock.trim() === '' ? null : Math.max(0, Math.floor(Number(d.stock)));
  if (d.saleMode === 'mrp') {
    const price = rupeesToPaise(d.price);
    const offer = optional(d.offer);
    if (!price) errors.price = t('prices.priceInvalid');
    if (d.offer.trim() && (!offer || (!!price && offer >= price))) {
      errors.offer = t('prices.offerInvalid');
    }
    if (Object.keys(errors).length) return { errors };
    return {
      errors,
      parsed: {
        pricePaise: price,
        offerPricePaise: offer,
        pricePerKgPaise: null,
        offerPricePerKgPaise: null,
        weightGrams: null,
        offerEndsAt: offer ? istLocalToIso(d.offerEnds) : null,
        stockQty,
      },
    };
  }
  const perKg = rupeesToPaise(d.perKg);
  const offerPerKg = optional(d.offerPerKg);
  const grams = toGrams(d.weight, d.weightUnit);
  if (!perKg) errors.price = t('prices.perKgInvalid');
  if (!grams) errors.weight = t('prices.weightInvalid');
  if (perKg && grams && kiloUnitPaise(perKg, grams) < 1) errors.price = t('prices.perKgInvalid');
  if (
    d.offerPerKg.trim() &&
    (!offerPerKg ||
      (!!perKg && offerPerKg >= perKg) ||
      (!!perKg && !!grams && kiloUnitPaise(offerPerKg, grams) >= kiloUnitPaise(perKg, grams)))
  ) {
    errors.offer = t('prices.offerPerKgInvalid');
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    parsed: {
      pricePaise: null,
      offerPricePaise: null,
      pricePerKgPaise: perKg,
      offerPricePerKgPaise: offerPerKg,
      weightGrams: grams,
      offerEndsAt: offerPerKg ? istLocalToIso(d.offerEnds) : null,
      stockQty,
    },
  };
}

function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t border-line pt-5 first:border-0 first:pt-0 sm:grid-cols-2">
      <legend className="contents">
        <span className="block text-base font-bold text-ink sm:col-span-2">{title}</span>
      </legend>
      {hint && <p className="-mt-2 text-sm text-muted sm:col-span-2">{hint}</p>}
      {children}
    </fieldset>
  );
}

function ItemForm({
  categories,
  initial,
  item,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  categories: Category[];
  initial: Draft;
  /** the product being edited; absent when adding */
  item?: Item;
  onSubmit: (d: Draft, parsed: Parsed) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const weightId = useId();
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setD({ ...d, [k]: e.target.value });
    if (Object.keys(errors).length) setErrors({});
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseDraft(d, t);
    setErrors(r.errors);
    if (r.parsed) onSubmit(d, r.parsed);
  };

  // Live preview of one kilo pack, priced the same way as the server.
  const perKg = rupeesToPaise(d.perKg);
  const offerPerKg = d.offerPerKg.trim() ? rupeesToPaise(d.offerPerKg) : null;
  const grams = toGrams(d.weight, d.weightUnit);
  const kiloPreview =
    d.saleMode === 'kilo' && perKg && grams
      ? {
          weight: formatWeight(grams),
          price: formatPaise(kiloUnitPaise(perKg, grams)),
          offer: offerPerKg ? formatPaise(kiloUnitPaise(offerPerKg, grams)) : null,
        }
      : null;

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <FormSection title={t('prices.sectionProduct')}>
        <Field label={t('prices.nameEn')}>
          <Input required minLength={2} value={d.nameEn} onChange={set('nameEn')} />
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
        <Field label={t('prices.nameTe')}>
          <Input value={d.nameTe} onChange={set('nameTe')} lang="te" />
        </Field>
        <Field label={t('prices.nameHi')}>
          <Input value={d.nameHi} onChange={set('nameHi')} lang="hi" />
        </Field>
        <Field label={t('prices.pack')} hint={t('prices.packHint')} className="sm:col-span-2">
          <Input
            value={d.packDesc}
            onChange={set('packDesc')}
            placeholder={t('prices.packPlaceholder')}
          />
        </Field>
      </FormSection>

      <FormSection title={t('prices.sectionKind')}>
        <div className="sm:col-span-2">
          <Segmented<ItemKind>
            label={t('prices.kind')}
            value={d.kind}
            onChange={(v) => setD({ ...d, kind: v })}
            options={[
              { value: 'product', label: t('prices.kindProduct') },
              { value: 'kit', label: t('prices.kindKit'), sub: t('prices.kindKitSub') },
            ]}
          />
        </div>
        {d.kind === 'kit' && (
          <>
            <Field label={t('prices.kitType')}>
              <Select value={d.kitType} onChange={set('kitType')}>
                {KIT_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`kits.type.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-[13px] leading-4 font-semibold text-ink">
                {t('prices.kitContents')}
              </p>
              {d.contents.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={t('prices.kitItemName', { n: i + 1 })}
                    value={c.name}
                    onChange={(e) =>
                      setD({
                        ...d,
                        contents: d.contents.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                    className="mt-0 min-w-0 flex-1"
                  />
                  <Input
                    aria-label={t('prices.kitItemQty', { n: i + 1 })}
                    inputMode="numeric"
                    value={c.qty}
                    onChange={(e) =>
                      setD({
                        ...d,
                        contents: d.contents.map((x, j) =>
                          j === i ? { ...x, qty: e.target.value } : x,
                        ),
                      })
                    }
                    className="mt-0 w-20"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('prices.kitRemoveRow', { n: i + 1 })}
                    disabled={d.contents.length === 1}
                    onClick={() => setD({ ...d, contents: d.contents.filter((_, j) => j !== i) })}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setD({ ...d, contents: [...d.contents, { name: '', qty: '1' }] })}
              >
                + {t('prices.kitAddRow')}
              </Button>
            </div>
          </>
        )}
      </FormSection>

      <FormSection title={t('prices.sectionSale')} hint={t('prices.saleModeHint')}>
        <div className="sm:col-span-2">
          <Segmented<SaleMode>
            label={t('prices.saleMode')}
            value={d.saleMode}
            onChange={(v) => {
              setD({ ...d, saleMode: v });
              setErrors({});
            }}
            options={[
              { value: 'mrp', label: t('prices.saleModeMrp'), sub: t('prices.saleModeMrpSub') },
              { value: 'kilo', label: t('prices.saleModeKilo'), sub: t('prices.saleModeKiloSub') },
            ]}
          />
        </div>
        {d.saleMode === 'mrp' ? (
          <>
            <Field label={t('prices.price')} hint={t('prices.priceHint')}>
              <Input
                required
                inputMode="decimal"
                value={d.price}
                onChange={set('price')}
                placeholder="₹"
                aria-invalid={!!errors.price}
              />
              {errors.price && <FieldError>{errors.price}</FieldError>}
            </Field>
            <Field label={t('prices.offer')} hint={t('prices.offerHint')}>
              <Input
                inputMode="decimal"
                value={d.offer}
                onChange={set('offer')}
                placeholder="₹"
                aria-invalid={!!errors.offer}
              />
              {errors.offer && <FieldError>{errors.offer}</FieldError>}
            </Field>
          </>
        ) : (
          <>
            <Field label={t('prices.perKg')} hint={t('prices.perKgHint')}>
              <Input
                required
                inputMode="decimal"
                value={d.perKg}
                onChange={set('perKg')}
                placeholder="₹ / kg"
                aria-invalid={!!errors.price}
              />
              {errors.price && <FieldError>{errors.price}</FieldError>}
            </Field>
            <Field label={t('prices.offerPerKg')} hint={t('prices.offerHint')}>
              <Input
                inputMode="decimal"
                value={d.offerPerKg}
                onChange={set('offerPerKg')}
                placeholder="₹ / kg"
                aria-invalid={!!errors.offer}
              />
              {errors.offer && <FieldError>{errors.offer}</FieldError>}
            </Field>
            <div className="text-[13px] leading-4 font-semibold text-ink">
              <label htmlFor={weightId}>{t('prices.weight')}</label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id={weightId}
                  inputMode="decimal"
                  value={d.weight}
                  onChange={set('weight')}
                  placeholder={d.weightUnit === 'kg' ? '1' : '500'}
                  required
                  aria-invalid={!!errors.weight}
                  className="mt-0 min-w-0 flex-1"
                />
                <Segmented<'g' | 'kg'>
                  label={t('prices.weightUnit')}
                  value={d.weightUnit}
                  onChange={(v) => setD({ ...d, weightUnit: v })}
                  options={[
                    { value: 'g', label: 'g' },
                    { value: 'kg', label: 'kg' },
                  ]}
                />
              </div>
              <span className="mt-1 block text-xs font-normal text-muted">
                {t('prices.weightHint')}
              </span>
              {errors.weight && <FieldError>{errors.weight}</FieldError>}
            </div>
            <div className="self-end">
              {kiloPreview ? (
                <Notice className="tabular-nums">
                  {t('prices.kiloPreview', kiloPreview)}
                  {kiloPreview.offer &&
                    ` · ${t('prices.kiloPreviewOffer', { offer: kiloPreview.offer })}`}
                </Notice>
              ) : (
                <p className="text-sm text-muted">{t('prices.kiloPreviewEmpty')}</p>
              )}
            </div>
          </>
        )}
        <Field label={t('prices.offerEnds')}>
          <Input
            type="datetime-local"
            value={d.offerEnds}
            onChange={set('offerEnds')}
            disabled={!(d.saleMode === 'mrp' ? d.offer : d.offerPerKg).trim()}
          />
        </Field>
      </FormSection>

      <FormSection title={t('prices.sectionStock')}>
        <Field label={t('prices.stock')} hint={t('prices.stockHint')}>
          <Input type="number" min={0} value={d.stock} onChange={set('stock')} />
        </Field>
        <Field label={t('prices.rack')} hint={t('prices.rackHint')}>
          <Input value={d.rackCode} onChange={set('rackCode')} placeholder="B3" maxLength={10} />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <p className="text-[13px] leading-4 font-semibold text-ink">{t('prices.barcode')}</p>
          {item?.barcode && !d.newBarcode ? (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-ivory p-3">
              <Barcode code={item.barcode} className="h-16 w-auto" />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setD({ ...d, newBarcode: true, boxBarcode: '' })}
              >
                {t('prices.newBarcode')}
              </Button>
            </div>
          ) : (
            <Notice>{item ? t('prices.barcodeWillRegenerate') : t('prices.barcodeAuto')}</Notice>
          )}
          <details className="group text-sm">
            <summary className="cursor-pointer font-semibold text-plum">
              {t('prices.boxBarcodeToggle')}
            </summary>
            <Field
              label={t('prices.boxBarcode')}
              hint={t('prices.boxBarcodeHint')}
              className="mt-3"
            >
              <Input
                value={d.boxBarcode}
                onChange={set('boxBarcode')}
                inputMode="numeric"
                pattern="[0-9A-Za-z\-]{4,32}"
                maxLength={32}
              />
            </Field>
          </details>
        </div>
      </FormSection>

      <FormSection title={t('prices.sectionCert')}>
        <Field label={t('prices.cert')} hint={t('prices.certOptional')}>
          <Select value={d.greenCert} onChange={set('greenCert')}>
            <option value="">{t('prices.certNone')}</option>
            {GREEN_CERTS.map((c) => (
              <option key={c} value={c}>
                {t(`greenCert.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('prices.certRef')} hint={t('prices.certRefHint')}>
          <Input
            required={!!d.greenCert}
            minLength={2}
            value={d.greenRef}
            onChange={set('greenRef')}
            disabled={!d.greenCert}
          />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-[13px] leading-4 font-semibold text-ink">{t('prices.tags')}</p>
          <p className="text-xs text-muted">{t('prices.tagsHint')}</p>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((tag) => (
              <label
                key={tag}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-plum"
                  checked={d[tag]}
                  onChange={(e) => setD({ ...d, [tag]: e.target.checked })}
                />
                {t(`prices.tag.${tag}`)}
              </label>
            ))}
          </div>
        </div>
      </FormSection>

      <div className="space-y-3 border-t border-line pt-5">
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-danger">
            {t('prices.fixErrors')}
          </p>
        )}
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

function FieldError({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-xs font-normal text-danger">{children}</span>;
}

const rupees = (paise: number | null) => (paise ? String(paise / 100) : '');

const toDraft = (i: Item): Draft => ({
  categoryId: i.categoryId,
  nameEn: i.nameEn,
  nameTe: i.nameTe ?? '',
  nameHi: i.nameHi ?? '',
  packDesc: i.packDesc ?? '',
  saleMode: i.saleMode,
  price: i.saleMode === 'mrp' ? rupees(i.pricePaise) : '',
  offer: i.saleMode === 'mrp' ? rupees(i.offerPricePaise) : '',
  perKg: rupees(i.pricePerKgPaise),
  offerPerKg: rupees(i.offerPricePerKgPaise),
  ...(i.weightGrams == null
    ? { weight: '', weightUnit: 'g' as const }
    : i.weightGrams % 1000 === 0 || i.weightGrams > 1000
      ? { weight: String(i.weightGrams / 1000), weightUnit: 'kg' as const }
      : { weight: String(i.weightGrams), weightUnit: 'g' as const }),
  offerEnds: isoToIstLocal(i.offerEndsAt),
  greenCert: i.greenCert ?? '',
  greenRef: i.greenRef ?? '',
  kind: i.kind,
  kitType: i.kitType ?? 'family',
  contents: i.contents?.map((c) => ({ name: c.name, qty: String(c.qty) })) ?? [
    { name: '', qty: '1' },
  ],
  rackCode: i.rackCode ?? '',
  boxBarcode: '',
  newBarcode: false,
  stock: i.stockQty == null ? '' : String(i.stockQty),
  isRecommended: i.isRecommended,
  isPopular: i.isPopular,
  isStandard: i.isStandard,
});

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

/** Only the selected mode's price fields go to the server; it derives the rest (G11). */
const toBody = (d: Draft, p: Parsed, editing: boolean) => ({
  categoryId: d.categoryId,
  nameEn: d.nameEn.trim(),
  nameTe: opt(d.nameTe),
  nameHi: opt(d.nameHi),
  packDesc: opt(d.packDesc),
  saleMode: d.saleMode,
  ...(d.saleMode === 'mrp'
    ? { pricePaise: p.pricePaise!, offerPricePaise: p.offerPricePaise }
    : {
        pricePerKgPaise: p.pricePerKgPaise,
        offerPricePerKgPaise: p.offerPricePerKgPaise,
        weightGrams: p.weightGrams,
      }),
  offerEndsAt: p.offerEndsAt,
  stockQty: p.stockQty,
  greenCert: d.greenCert || null,
  greenRef: d.greenCert ? d.greenRef.trim() : null,
  kind: d.kind,
  ...(d.kind === 'kit'
    ? {
        kitType: d.kitType,
        contents: d.contents
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), qty: Math.max(1, Math.floor(Number(c.qty) || 1)) })),
      }
    : { kitType: null, contents: null }),
  rackCode: opt(d.rackCode),
  isRecommended: d.isRecommended,
  isPopular: d.isPopular,
  isStandard: d.isStandard,
  // A box barcode replaces the generated one; asking for a new one sends null.
  ...(d.boxBarcode.trim()
    ? { barcode: d.boxBarcode.trim() }
    : editing && d.newBarcode
      ? { barcode: null }
      : {}),
});

function PhotoButton({ item }: { item: Item }) {
  const { t } = useTranslation();
  const upload = useItemImage();
  const [tooBig, setTooBig] = useState(false);
  const [held, setHeld] = useState<{ base64: string; issue: PhotoIssue } | null>(null);
  const send = (base64: string) => {
    setHeld(null);
    upload.mutate({ id: item.id, image: { contentType: 'image/jpeg', base64 } });
  };
  return (
    <span>
      <label className="inline-flex min-h-10 cursor-pointer items-center rounded-2xl px-3 text-sm font-semibold text-plum hover:bg-plum/5">
        <Icon icon={Camera} /> {upload.isPending ? t('common.loading') : t('prices.uploadPhoto')}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={upload.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const [base64, issue] = await Promise.all([
              photoToJpegBase64(file, 900),
              checkPhoto(file),
            ]);
            const big = base64.length > 2_600_000;
            setTooBig(big);
            if (big) return;
            if (issue) setHeld({ base64, issue });
            else send(base64);
          }}
        />
      </label>
      {tooBig && <span className="text-xs text-danger">{t('prices.photoTooBig')}</span>}
      {held && (
        <span className="block">
          <PhotoAdvice issue={held.issue} />
          <button
            type="button"
            className="min-h-10 text-xs font-semibold text-plum underline"
            onClick={() => send(held.base64)}
          >
            {t('photo.useAnyway')}
          </button>
        </span>
      )}
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
  const remove = useRemoveItem();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState<Item | null>(null);
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
          <h2 className="mb-4 text-xl font-bold">{t('prices.add')}</h2>
          <ItemForm
            categories={cats}
            initial={emptyDraft(cats)}
            busy={create.isPending}
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(d, p) =>
              create.mutate(toBody(d, p, false), { onSuccess: () => setAdding(false) })
            }
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
                item={item}
                busy={patch.isPending}
                error={patch.error}
                onCancel={() => setEditing(null)}
                onSubmit={(d, p) =>
                  patch.mutate(
                    { id: item.id, patch: toBody(d, p, true) },
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
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-050 font-display font-extrabold text-plum">
                      #{item.itemNo}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold">{itemName(item)}</p>
                      <span className="shrink-0 text-right">
                        <span className="font-display text-xl font-extrabold">
                          {formatPaise(item.effectivePricePaise)}
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
                      <Badge tone={item.saleMode === 'kilo' ? 'gold' : 'muted'}>
                        {item.saleMode === 'kilo'
                          ? t('prices.badgeKilo', {
                              weight: formatWeight(item.weightGrams ?? 0),
                              rate: formatPaise(item.pricePerKgPaise ?? 0),
                            })
                          : t('prices.badgeMrp')}
                      </Badge>
                      {TAGS.filter((tag) => item[tag]).map((tag) => (
                        <Badge key={tag} tone="plum">
                          {t(`prices.tag.${tag}`)}
                        </Badge>
                      ))}
                      {item.rackCode && (
                        <Badge tone="muted">{t('counter.rack', { rack: item.rackCode })}</Badge>
                      )}
                      <GreenBadge cert={item.greenCert} reference={item.greenRef} />
                      {item.barcode && (
                        <button
                          type="button"
                          onClick={() => setLabel(item)}
                          className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs font-semibold text-plum ring-1 ring-brand-100 ring-inset hover:bg-brand-050"
                          aria-label={t('prices.printLabelFor', { name: itemName(item) })}
                        >
                          ▥ {item.barcode}
                        </button>
                      )}
                      {item.stockQty != null && (
                        <Badge tone={item.stockQty <= 5 ? 'danger' : 'muted'}>
                          {t('prices.left', { count: item.stockQty })}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        disabled={remove.isPending}
                        onClick={() =>
                          window.confirm(t('prices.removeConfirm', { name: itemName(item) })) &&
                          remove.mutate(item.id)
                        }
                      >
                        {t('prices.remove')}
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
      <ErrorText error={remove.error} />
      {label?.barcode && (
        <BarcodeLabelDialog
          key={label.id}
          name={itemName(label)}
          code={label.barcode}
          pricePaise={label.effectivePricePaise}
          detail={
            label.saleMode === 'kilo' && label.weightGrams
              ? formatWeight(label.weightGrams)
              : label.packDesc
          }
          onClose={() => setLabel(null)}
        />
      )}
    </div>
  );
}
