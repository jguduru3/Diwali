import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, Field, Input, Notice } from '../../components/ui';
import { useSaveSettings, useShopContext, useShopPhoto } from '../../lib/queries';
import { photoToJpegBase64 } from '../../lib/image';
import { checkPhoto, type PhotoIssue } from '../../lib/photoQuality';
import { PhotoAdvice } from '../../components/FilePicker';
import { Icon } from '../../components/Icon';
import { Camera } from 'lucide-react';

/** The shop entrance photo: customers see it beside the shop's name, so they find the shop. */
function EntrancePhoto() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const upload = useShopPhoto();
  const [issue, setIssue] = useState<PhotoIssue | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const photo = ctx.data?.photoUrl;
  return (
    <Card className="max-w-xl overflow-hidden">
      {photo ? (
        <img
          src={photo}
          alt={t('shopPhoto.alt', { name: ctx.data?.name ?? '' })}
          className="aspect-[16/9] w-full object-cover"
        />
      ) : (
        <div className="grid aspect-[16/9] w-full place-items-center bg-brand-050 text-gold-deep">
          <Icon icon={Camera} className="h-10 w-10" />
        </div>
      )}
      <div className="p-6">
        <h2 className="text-xl font-bold">{t('shopPhoto.title')}</h2>
        <p className="mt-1 mb-4 text-muted">{t('shopPhoto.body')}</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-plum px-5 font-bold text-white hover:bg-plum-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-plum">
          <Icon icon={Camera} className="h-4 w-4" />
          {upload.isPending
            ? t('common.loading')
            : photo
              ? t('shopPhoto.replace')
              : t('shopPhoto.add')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={upload.isPending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const [base64, found] = await Promise.all([
                photoToJpegBase64(file, 1400),
                checkPhoto(file),
              ]);
              const big = base64.length > 2_600_000;
              setTooBig(big);
              setIssue(found);
              if (!big) upload.mutate({ contentType: 'image/jpeg', base64 });
            }}
          />
        </label>
        <div className="mt-3 space-y-2">
          <PhotoAdvice issue={issue} />
          {tooBig && <Notice tone="danger">{t('shopPhoto.tooBig')}</Notice>}
          <ErrorText error={upload.error} />
          {upload.isSuccess && <Notice tone="emerald">{t('shopPhoto.saved')}</Notice>}
        </div>
      </div>
    </Card>
  );
}

/** Opening hours and the entrance photo (owner, or the agent setting the shop up). */
export function Hours() {
  return (
    <div className="space-y-6">
      <OpeningHours />
      <EntrancePhoto />
    </div>
  );
}

/** Opening hours. Customers see open / closed from these. */
function OpeningHours() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const save = useSaveSettings();
  const [from, setFrom] = useState(ctx.data?.openFrom ?? '10:00');
  const [to, setTo] = useState(ctx.data?.openTo ?? '22:00');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ openFrom: from, openTo: to });
  };
  return (
    <Card className="max-w-xl p-6">
      <h2 className="text-xl font-bold">{t('hours.title')}</h2>
      <p className="mt-1 mb-5 text-muted">{t('hours.body')}</p>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hours.opens')}>
          <Input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('hours.closes')}>
          <Input type="time" required value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <ErrorText error={save.error} />
          {save.isSuccess && <Notice tone="emerald">{t('hours.saved')}</Notice>}
          <Button disabled={save.isPending}>{t('common.save')}</Button>
        </div>
      </form>
    </Card>
  );
}
