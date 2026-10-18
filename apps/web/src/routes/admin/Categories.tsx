import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, Card, Field, Input, Notice, Spinner, cx } from '../../components/ui';
import { categoryName } from '../../lib/format';
import { useAdminCategories, useCreateCategory, usePatchCategory } from '../../lib/queries';

/** Categories; banned ones (joined/series, barium) can never hold items (G7). */
export function Categories() {
  const { t } = useTranslation();
  const list = useAdminCategories();
  const create = useCreateCategory();
  const patch = usePatchCategory();
  const [f, setF] = useState({ slug: '', nameEn: '', nameTe: '' });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { slug: f.slug, nameEn: f.nameEn, nameTe: f.nameTe || undefined },
      { onSuccess: () => setF({ slug: '', nameEn: '', nameTe: '' }) },
    );
  };

  return (
    <div className="space-y-5">
      <Notice>{t('admin.categoriesHelp')}</Notice>
      <Card className="p-6">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-4 sm:items-end">
          <Field label={t('admin.slug')}>
            <Input
              required
              pattern="[a-z0-9-]{2,40}"
              value={f.slug}
              onChange={(e) => setF({ ...f, slug: e.target.value })}
            />
          </Field>
          <Field label={t('prices.nameEn')}>
            <Input
              required
              value={f.nameEn}
              onChange={(e) => setF({ ...f, nameEn: e.target.value })}
            />
          </Field>
          <Field label={t('prices.nameTe')}>
            <Input value={f.nameTe} onChange={(e) => setF({ ...f, nameTe: e.target.value })} />
          </Field>
          <Button disabled={create.isPending}>+ {t('admin.addCategory')}</Button>
        </form>
        <ErrorText error={create.error} />
      </Card>
      {list.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={list.error ?? patch.error} />
      <ul className="grid gap-3 md:grid-cols-2">
        {list.data?.map((c) => (
          <Card
            as="li"
            key={c.id}
            className={cx(
              'flex items-center gap-4 p-4',
              c.isBanned && 'border-danger/30 bg-danger-soft/40',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{categoryName(c)}</p>
              <p className="text-xs text-muted">{c.slug}</p>
              {c.isBanned && <p className="mt-1 text-xs text-danger">{c.bannedReason}</p>}
            </div>
            {c.isBanned ? (
              <Badge tone="danger">{t('admin.banned')}</Badge>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={patch.isPending}
                onClick={() =>
                  window.confirm(t('admin.banConfirm', { name: c.nameEn })) &&
                  patch.mutate({
                    id: c.id,
                    patch: { isBanned: true, bannedReason: t('admin.banReason') },
                  })
                }
              >
                {t('admin.ban')}
              </Button>
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}
