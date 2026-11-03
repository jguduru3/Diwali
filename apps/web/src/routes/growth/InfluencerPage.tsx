import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  Notice,
  PageTitle,
  Select,
  Spinner,
  Stat,
} from '../../components/ui';
import { ApiRequestError } from '../../lib/api';
import { useInfluencerMe, useInfluencerRegister } from '../../lib/growth';
import { ShareLink } from './AgentPage';
import { TermsCheck } from './TermsCheck';

const PLATFORMS = ['instagram', 'youtube', 'facebook', 'whatsapp', 'other'] as const;

function Register() {
  const { t } = useTranslation();
  const reg = useInfluencerRegister();
  const [f, setF] = useState({
    handle: '',
    platform: 'instagram' as (typeof PLATFORMS)[number],
    upiId: '',
  });
  const [terms, setTerms] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reg.mutate({ ...f, acceptTerms: terms as true });
  };
  return (
    <Card className="mx-auto max-w-xl p-6 sm:p-8">
      <h2 className="text-xl font-bold">{t('influencer.registerTitle')}</h2>
      <p className="mt-1 mb-5 text-sm text-muted">{t('influencer.registerBody')}</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('influencer.handle')}>
          <Input
            required
            minLength={2}
            value={f.handle}
            onChange={(e) => setF({ ...f, handle: e.target.value })}
            placeholder="@yourname" // i18n-ignore: format example
          />
        </Field>
        <Field label={t('influencer.platform')}>
          <Select
            value={f.platform}
            onChange={(e) => setF({ ...f, platform: e.target.value as typeof f.platform })}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(`influencer.platforms.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('wallet.upiId')} hint={t('wallet.upiHint')}>
          <Input
            required
            value={f.upiId}
            onChange={(e) => setF({ ...f, upiId: e.target.value })}
            placeholder="name@bank" // i18n-ignore: format example
          />
        </Field>
        <TermsCheck party="influencer" checked={terms} onChange={setTerms} />
        <ErrorText error={reg.error} />
        <Button disabled={!terms || reg.isPending}>{t('influencer.register')}</Button>
      </form>
    </Card>
  );
}

/** Influencer: share code, followers' first orders, agents brought in. Money goes to the wallet. */
export function InfluencerPage() {
  const { t } = useTranslation();
  const me = useInfluencerMe();
  if (me.isPending) return <Spinner label={t('common.loading')} />;
  const none = me.error instanceof ApiRequestError && me.error.code === 'not_influencer';
  const origin = window.location.origin;
  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow={t('influencer.eyebrow')}
        title={t('influencer.title')}
        subtitle={t('influencer.subtitle')}
      />
      {none ? (
        <Register />
      ) : me.error ? (
        <ErrorText error={me.error} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <Card className="flex items-center gap-4 p-5">
              <QrCode
                text={`${origin}/r/${me.data!.code}`}
                label={me.data!.code}
                className="h-28 w-28"
              />
              <div>
                <p className="text-[13px] font-semibold text-muted">{t('influencer.yourCode')}</p>
                <p className="text-2xl font-extrabold tracking-wide">{me.data!.code}</p>
                <Badge tone={me.data!.status === 'active' ? 'emerald' : 'gold'}>
                  {t(`agent.status.${me.data!.status}`)}
                </Badge>
              </div>
            </Card>
            <Card className="space-y-4 p-5">
              {me.data!.status === 'pending' && <Notice>{t('influencer.pendingNote')}</Notice>}
              <div>
                <p className="mb-2 text-[13px] font-semibold text-muted">
                  {t('influencer.shareCustomers')}
                </p>
                <ShareLink url={`${origin}/r/${me.data!.code}`} text={t('influencer.shareText')} />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-muted">
                  {t('influencer.shareAgents')}
                </p>
                <ShareLink
                  url={`${origin}/agent?recruit=${me.data!.code}`}
                  text={t('influencer.agentText')}
                />
              </div>
              <p className="text-xs text-muted">{t('influencer.disclose')}</p>
            </Card>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label={t('influencer.visits')} value={me.data!.visits} />
            <Stat label={t('influencer.referred')} value={me.data!.referred} />
            <Stat label={t('influencer.rewarded')} value={me.data!.rewarded} />
            <Stat label={t('influencer.agents')} value={me.data!.agentsRecruited} />
          </div>
          <ButtonLink to="/wallet" variant="secondary">
            {t('agent.openWallet')}
          </ButtonLink>
        </>
      )}
    </div>
  );
}
