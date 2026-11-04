import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { istDate } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, Card, Field, Input, Select, Spinner, Toggle } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useAdminClusters, useAdminShops, useCreateShop, usePatchShop } from '../../lib/queries';
import { LicenceBadge } from '../shop/Licence';
import { PaymentSettingsForm } from '../shop/Payments';

const num = (s: string) => (s.trim() ? Number(s) : undefined);

/** Onboard shops; toggling "live" off hides a shop at once (SPEC §15). */
export function Shops() {
  const { t } = useTranslation();
  const shops = useAdminShops();
  const clusters = useAdminClusters();
  const create = useCreateShop();
  const patch = usePatchShop();
  const [open, setOpen] = useState(false);
  const [payments, setPayments] = useState<string | null>(null);
  const [f, setF] = useState({
    shortCode: '',
    name: '',
    area: '',
    clusterId: '',
    address: '',
    lat: '',
    lng: '',
    phone: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        shortCode: f.shortCode,
        name: f.name,
        area: f.area,
        clusterId: f.clusterId || null,
        address: f.address || undefined,
        lat: num(f.lat),
        lng: num(f.lng),
        phone: f.phone || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setF({
            shortCode: '',
            name: '',
            area: '',
            clusterId: '',
            address: '',
            lat: '',
            lng: '',
            phone: '',
          });
        },
      },
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <p className="text-muted">{t('admin.shopsHelp')}</p>
        {!open && <Button onClick={() => setOpen(true)}>+ {t('admin.addShop')}</Button>}
      </div>
      {open && (
        <Card className="p-6">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
            <Field label={t('admin.shortCode')} hint={t('admin.shortCodeHint')}>
              <Input
                required
                pattern="[A-Za-z0-9]{3,6}"
                value={f.shortCode}
                onChange={set('shortCode')}
                className="uppercase"
              />
            </Field>
            <Field label={t('members.name')}>
              <Input required minLength={2} value={f.name} onChange={set('name')} />
            </Field>
            <Field label={t('home.area')}>
              <Input required minLength={2} value={f.area} onChange={set('area')} />
            </Field>
            <Field label={t('members.cluster')}>
              <Select value={f.clusterId} onChange={set('clusterId')}>
                <option value="">{t('admin.noCluster')}</option>
                {clusters.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.address')} className="sm:col-span-2">
              <Input value={f.address} onChange={set('address')} />
            </Field>
            <Field label={t('admin.lat')}>
              <Input inputMode="decimal" value={f.lat} onChange={set('lat')} placeholder="17.44" />
            </Field>
            <Field label={t('admin.lng')}>
              <Input inputMode="decimal" value={f.lng} onChange={set('lng')} placeholder="78.35" />
            </Field>
            <Field label={t('members.phone')}>
              <Input type="tel" value={f.phone} onChange={set('phone')} />
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
      {shops.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={shops.error ?? patch.error} />
      <ul className="grid gap-3">
        {shops.data?.map((s) => (
          <Card as="li" key={s.id} className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-semibold">
                {s.name} <span className="font-sans text-sm text-muted">{s.shortCode}</span>
              </p>
              <p className="text-sm text-muted">
                {[s.area, s.clusterName, t('admin.itemCount', { count: s.itemCount })]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={s.visible ? 'emerald' : 'muted'}>
                  {s.visible ? t('shopApp.listed') : t('shopApp.hidden')}
                </Badge>
                {s.licenceStatus ? (
                  <LicenceBadge status={s.licenceStatus} />
                ) : (
                  <Badge tone="danger">{t('admin.noLicence')}</Badge>
                )}
                {s.licenceValidFrom && s.licenceValidFrom > istDate() ? (
                  <Badge tone="gold">
                    {t('admin.startsOn', { date: dayIST(s.licenceValidFrom) })}
                  </Badge>
                ) : (
                  s.licenceValidTo && (
                    <Badge tone="muted">
                      {t('admin.validTo', { date: dayIST(s.licenceValidTo) })}
                    </Badge>
                  )
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPayments(payments === s.id ? null : s.id)}
            >
              {t('admin.counterPayments')}
            </Button>
            <label className="flex items-center gap-3 text-sm font-semibold">
              {t('admin.live')}
              <Toggle
                checked={s.isLive}
                label={t('admin.liveToggle', { name: s.name })}
                disabled={patch.isPending}
                onChange={(isLive) => patch.mutate({ id: s.id, patch: { isLive } })}
              />
            </label>
            {payments === s.id && (
              <div className="w-full border-t border-line/70 pt-4">
                <PaymentSettingsForm shopId={s.id} />
              </div>
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}
