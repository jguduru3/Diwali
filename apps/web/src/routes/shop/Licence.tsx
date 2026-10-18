import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LICENCE_IMAGE_MAX_BYTES, type LicenceStatus } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, Card, Field, Input, Notice, Spinner } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { photoToJpegBase64 } from '../../lib/image';
import { useOwnLicences, useSubmitLicence } from '../../lib/queries';

const statusTone: Record<LicenceStatus, 'emerald' | 'gold' | 'danger' | 'muted'> = {
  verified: 'emerald',
  pending: 'gold',
  rejected: 'danger',
  expired: 'muted',
};

export function LicenceBadge({ status }: { status: LicenceStatus }) {
  const { t } = useTranslation();
  return <Badge tone={statusTone[status]}>{t(`licence.status.${status}`)}</Badge>;
}

/** Owner uploads a licence photo; it stays private until an admin checks it. */
export function Licence() {
  const { t } = useTranslation();
  const list = useOwnLicences();
  const submit = useSubmitLicence();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({
    licenceNo: '',
    licenceType: 'LE-5',
    issuedBy: '',
    validFrom: '',
    validTo: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!file) return setErr(t('licence.needPhoto'));
    let base64: string;
    try {
      base64 = await photoToJpegBase64(file);
    } catch {
      return setErr(t('licence.badPhoto'));
    }
    if ((base64.length * 3) / 4 > LICENCE_IMAGE_MAX_BYTES) return setErr(t('licence.tooBig'));
    submit.mutate(
      {
        licenceNo: f.licenceNo.trim(),
        licenceType: f.licenceType.trim(),
        issuedBy: f.issuedBy.trim() || undefined,
        validFrom: f.validFrom,
        validTo: f.validTo,
        image: { contentType: 'image/jpeg', base64 },
      },
      {
        onSuccess: () => {
          setFile(null);
          setF({ licenceNo: '', licenceType: 'LE-5', issuedBy: '', validFrom: '', validTo: '' });
        },
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t('licence.yours')}</h2>
        {list.isPending && <Spinner label={t('common.loading')} />}
        <ErrorText error={list.error} />
        {list.data?.length === 0 && <Notice>{t('licence.none')}</Notice>}
        {list.data?.map((l) => (
          <Card key={l.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{l.licenceNo}</p>
                <p className="text-sm text-muted">
                  {l.licenceType}
                  {l.issuedBy && ` · ${l.issuedBy}`}
                </p>
                <p className="mt-1 text-sm">
                  {t('licence.valid', {
                    from: l.validFrom ? dayIST(l.validFrom) : '—',
                    to: dayIST(l.validTo),
                  })}
                </p>
                {l.notes && <p className="mt-1 text-sm text-muted">“{l.notes}”</p>}
              </div>
              <LicenceBadge status={l.status} />
            </div>
          </Card>
        ))}
      </section>

      <Card className="p-6">
        <h2 className="text-xl font-semibold">{t('licence.uploadTitle')}</h2>
        <p className="mt-1 mb-5 text-sm text-muted">{t('licence.uploadBody')}</p>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label={t('licence.no')}>
            <Input required minLength={3} value={f.licenceNo} onChange={set('licenceNo')} />
          </Field>
          <Field label={t('licence.type')}>
            <Input
              required
              value={f.licenceType}
              onChange={set('licenceType')}
              list="licence-types"
            />
            <datalist id="licence-types">
              <option value="LE-5" />
              <option value="Temporary" />
            </datalist>
          </Field>
          <Field label={t('licence.issuedBy')} className="sm:col-span-2">
            <Input value={f.issuedBy} onChange={set('issuedBy')} />
          </Field>
          <Field label={t('licence.from')}>
            <Input type="date" required value={f.validFrom} onChange={set('validFrom')} />
          </Field>
          <Field label={t('licence.to')}>
            <Input type="date" required value={f.validTo} onChange={set('validTo')} />
          </Field>
          <Field label={t('licence.photo')} className="sm:col-span-2" hint={file?.name}>
            <Input
              type="file"
              accept="image/*"
              capture="environment"
              className="py-2.5"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="space-y-3 sm:col-span-2">
            {err && <Notice tone="danger">{err}</Notice>}
            <ErrorText error={submit.error} />
            {submit.isSuccess && <Notice tone="emerald">{t('licence.sent')}</Notice>}
            <Button disabled={submit.isPending}>{t('licence.submit')}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
