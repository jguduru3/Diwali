import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, Input, Notice, PageTitle, Spinner, Stat } from '../../components/ui';
import { dateTimeIST, dayIST } from '../../lib/format';
import { useClaimReferral, useCredit } from '../../lib/growth';
import { ShareLink } from './AgentPage';

/** My credit: balance (a discount at a listed shop's counter, never cash), referral code, history. */
export function CreditPage() {
  const { t } = useTranslation();
  const c = useCredit();
  const claim = useClaimReferral();
  const [code, setCode] = useState('');
  if (c.isPending) return <Spinner label={t('common.loading')} />;
  if (c.error) return <ErrorText error={c.error} />;
  const v = c.data;
  const link = `${window.location.origin}/r/${v.referralCode}`;
  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow={t('credit.eyebrow')}
        title={t('credit.title')}
        subtitle={t('credit.subtitle')}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t('credit.balance')}
          value={formatPaise(v.balancePaise)}
          sub={t('credit.expires', { date: dayIST(v.expiresOn) })}
        />
        <Stat label={t('credit.invited')} value={v.invited} />
        <Stat label={t('credit.rewarded')} value={v.rewarded} />
      </div>
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-bold">{t('credit.shareTitle')}</h2>
        <p className="text-sm text-muted">{t('credit.shareBody')}</p>
        <p className="text-2xl font-extrabold tracking-wide">{v.referralCode}</p>
        <ShareLink url={link} text={t('credit.shareText')} />
        <Notice>{t('credit.rules')}</Notice>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-bold">{t('credit.haveCode')}</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            claim.mutate(code.trim().toUpperCase());
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label={t('credit.codeLabel')}
            placeholder="DXR-… / DXI-…" // i18n-ignore: format example
            className="mt-0 w-48"
          />
          <Button disabled={code.length < 10 || claim.isPending}>{t('credit.useCode')}</Button>
        </form>
        {claim.isSuccess && <Notice tone="emerald">{t('credit.codeSaved')}</Notice>}
        <ErrorText error={claim.error} />
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-bold">{t('credit.history')}</h2>
        {v.history.length === 0 && <p className="text-sm text-muted">{t('credit.noHistory')}</p>}
        <ul className="divide-y divide-line">
          {v.history.map((h) => (
            <li key={h.id} className="flex justify-between py-2 text-sm">
              <span>
                {t(`credit.reason.${h.reason}`)}
                <span className="block text-xs text-muted">{dateTimeIST(h.at)}</span>
              </span>
              <span className="font-semibold tabular-nums">
                {h.deltaPaise < 0 ? '−' : '+'}
                {formatPaise(Math.abs(h.deltaPaise))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
