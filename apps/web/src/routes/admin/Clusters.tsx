import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, Card, Field, Input, Spinner, Textarea, Toggle } from '../../components/ui';
import { useAdminClusters, useCreateCluster, usePatchCluster } from '../../lib/queries';

const num = (s: string) => (s.trim() ? Number(s) : undefined);

/** Shop clusters (grounds) with pickup notes shown to customers. */
export function Clusters() {
  const { t } = useTranslation();
  const list = useAdminClusters();
  const create = useCreateCluster();
  const patch = usePatchCluster();
  const [open, setOpen] = useState(false);
  const blank = {
    name: '',
    area: '',
    address: '',
    lat: '',
    lng: '',
    gateNotes: '',
  };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        name: f.name,
        area: f.area,
        address: f.address || undefined,
        lat: num(f.lat),
        lng: num(f.lng),
        gateNotes: f.gateNotes || undefined,
      },
      { onSuccess: () => (setOpen(false), setF(blank)) },
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <p className="text-muted">{t('admin.clustersHelp')}</p>
        {!open && <Button onClick={() => setOpen(true)}>+ {t('admin.addCluster')}</Button>}
      </div>
      {open && (
        <Card className="p-6">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
            <Field label={t('members.name')}>
              <Input required minLength={2} value={f.name} onChange={set('name')} />
            </Field>
            <Field label={t('home.area')}>
              <Input required minLength={2} value={f.area} onChange={set('area')} />
            </Field>
            <Field label={t('admin.address')} className="sm:col-span-3">
              <Input value={f.address} onChange={set('address')} />
            </Field>
            <Field label={t('admin.lat')}>
              <Input inputMode="decimal" value={f.lat} onChange={set('lat')} />
            </Field>
            <Field label={t('admin.lng')}>
              <Input inputMode="decimal" value={f.lng} onChange={set('lng')} />
            </Field>
            <Field label={t('admin.gateNotes')} className="sm:col-span-3">
              <Textarea rows={2} value={f.gateNotes} onChange={set('gateNotes')} />
            </Field>
            <div className="flex gap-3 sm:col-span-3">
              <Button disabled={create.isPending}>{t('common.save')}</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
          <ErrorText error={create.error} />
        </Card>
      )}
      {list.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={list.error ?? patch.error} />
      <ul className="grid gap-3 md:grid-cols-2">
        {list.data?.map((c) => (
          <Card as="li" key={c.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-semibold">{c.name}</p>
                <p className="text-sm text-muted">{c.address ?? c.area}</p>
              </div>
              <Toggle
                checked={c.isActive}
                label={t('admin.activeToggle', { name: c.name })}
                onChange={(isActive) => patch.mutate({ id: c.id, patch: { isActive } })}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="muted">{t('admin.shopCount', { count: c.shopCount })}</Badge>
            </div>
            {c.gateNotes && <p className="mt-3 text-sm text-muted">{c.gateNotes}</p>}
          </Card>
        ))}
      </ul>
    </div>
  );
}
