import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatPaise,
  GREEN_CERTS,
  rupeesToPaise,
  type Category,
  type GreenCert,
  type Item,
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
import {
  useCreateItem,
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
});

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
  onSubmit: (d: Draft, pricePaise: number) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(initial);
  const [priceErr, setPriceErr] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD({ ...d, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(d.price);
    setPriceErr(!paise);
    if (paise) onSubmit(d, paise);
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
      <Field label={t('prices.pack')}>
        <Input value={d.packDesc} onChange={set('packDesc')} placeholder="10 pcs" />
      </Field>
      <Field label={t('prices.price')}>
        <Input
          required
          inputMode="decimal"
          value={d.price}
          onChange={set('price')}
          placeholder="₹"
          aria-invalid={priceErr}
        />
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
});

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

/** Price list editor. Owners edit everything; counter staff toggle sold-out only. */
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
            onSubmit={(d, pricePaise) =>
              create.mutate(
                {
                  categoryId: d.categoryId,
                  nameEn: d.nameEn.trim(),
                  nameTe: opt(d.nameTe),
                  packDesc: opt(d.packDesc),
                  pricePaise,
                  greenCert: d.greenCert,
                  greenRef: d.greenRef.trim(),
                  rackCode: opt(d.rackCode),
                },
                { onSuccess: () => setAdding(false) },
              )
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
                busy={patch.isPending}
                error={patch.error}
                onCancel={() => setEditing(null)}
                onSubmit={(d, pricePaise) =>
                  patch.mutate(
                    {
                      id: item.id,
                      patch: {
                        categoryId: d.categoryId,
                        nameEn: d.nameEn.trim(),
                        nameTe: opt(d.nameTe),
                        packDesc: opt(d.packDesc),
                        pricePaise,
                        greenCert: d.greenCert,
                        greenRef: d.greenRef.trim(),
                        rackCode: opt(d.rackCode),
                      },
                    },
                    { onSuccess: () => setEditing(null) },
                  )
                }
              />
            ) : (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sand font-display font-semibold text-gold-deep">
                    #{item.itemNo}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold">{itemName(item)}</p>
                      <span className="shrink-0 font-display text-xl font-semibold">
                        {formatPaise(item.pricePaise)}
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
                    <span className="flex gap-1">
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
