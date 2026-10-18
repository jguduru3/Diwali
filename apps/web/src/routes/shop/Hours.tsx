import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, Field, Input, Notice } from '../../components/ui';
import { useSaveSettings, useShopContext } from '../../lib/queries';

/** Opening hours (owner). Customers see open / closed from these. */
export function Hours() {
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
      <h2 className="text-xl font-semibold">{t('hours.title')}</h2>
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
