import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MerchantPaymentSettings } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, Field, Input, Notice, Spinner, Toggle } from '../../components/ui';
import { usePaymentSettings, useSavePaymentSettings } from '../../lib/queries';

/**
 * How a merchant takes counter payments: UPI through their own YouPI-PG, card
 * machine, cash. Used by the owner (shop app) and by the platform team when
 * onboarding a merchant (admin → shops, pass `shopId`).
 */
export function PaymentSettingsForm({ shopId }: { shopId?: string }) {
  const { t } = useTranslation();
  const current = usePaymentSettings(shopId);
  const save = useSavePaymentSettings(shopId);
  const [f, setF] = useState<MerchantPaymentSettings | null>(null);
  const [secret, setSecret] = useState('');
  useEffect(() => {
    if (current.data && !f) setF(current.data);
  }, [current.data, f]);

  if (current.isPending || !f) return <Spinner label={t('common.loading')} />;
  const set =
    (k: 'youpiBaseUrl' | 'youpiMerchantId' | 'upiVpa') => (e: { target: { value: string } }) =>
      setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        youpiBaseUrl: f.youpiBaseUrl?.trim() || null,
        youpiMerchantId: f.youpiMerchantId?.trim() || null,
        ...(secret ? { youpiWebhookSecret: secret } : {}),
        upiVpa: f.upiVpa?.trim() || null,
        acceptsCard: f.acceptsCard,
        acceptsCash: f.acceptsCash,
      },
      {
        onSuccess: (v) => {
          setF(v);
          setSecret('');
        },
      },
    );
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <Notice tone="plum">{t('payments.body')}</Notice>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('payments.youpiTitle')}</h3>
        <p className="text-sm text-muted">{t('payments.youpiBody')}</p>
        {!f.youpiBaseUrl && <Notice>{t('payments.simulated')}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('payments.youpiUrl')}>
            <Input
              type="url"
              placeholder="https://pay.yourshop.in"
              value={f.youpiBaseUrl ?? ''}
              onChange={set('youpiBaseUrl')}
            />
          </Field>
          <Field label={t('payments.youpiMerchant')}>
            <Input value={f.youpiMerchantId ?? ''} onChange={set('youpiMerchantId')} />
          </Field>
          <Field
            label={t('payments.youpiSecret')}
            hint={f.hasWebhookSecret ? t('payments.secretSet') : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              minLength={16}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field label={t('payments.vpa')}>
            <Input placeholder="shop@bank" value={f.upiVpa ?? ''} onChange={set('upiVpa')} />
          </Field>
        </div>
        <Field label={t('payments.webhookUrl')}>
          <Input
            readOnly
            value={f.webhookUrl}
            className="font-mono text-sm"
            onFocus={(e) => e.target.select()}
          />
        </Field>
        <p className="text-xs text-muted">{t('payments.risk')}</p>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <Toggle
            checked={f.acceptsCard}
            label={t('payments.acceptsCard')}
            onChange={(v) => setF({ ...f, acceptsCard: v })}
          />
          {t('payments.acceptsCard')}
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold">
          <Toggle
            checked={f.acceptsCash}
            label={t('payments.acceptsCash')}
            onChange={(v) => setF({ ...f, acceptsCash: v })}
          />
          {t('payments.acceptsCash')}
        </label>
      </div>
      <ErrorText error={save.error} />
      {save.isSuccess && <Notice tone="emerald">{t('payments.saved')}</Notice>}
      <Button disabled={save.isPending}>{t('common.save')}</Button>
    </form>
  );
}

export function Payments() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-3xl p-6">
      <h2 className="mb-4 text-xl font-semibold">{t('payments.title')}</h2>
      <PaymentSettingsForm />
    </Card>
  );
}
