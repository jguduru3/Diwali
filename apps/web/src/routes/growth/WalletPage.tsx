import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPaise, rupeesToPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  PageTitle,
  Spinner,
  Stat,
} from '../../components/ui';
import { dateTimeIST } from '../../lib/format';
import { useSetPan, useWallet, useWithdraw } from '../../lib/growth';

/** Money wallet for agents and influencers: withdraw to the verified UPI ID, ₹2,000 a day. */
export function WalletPage() {
  const { t } = useTranslation();
  const w = useWallet();
  const out = useWithdraw();
  const pan = useSetPan();
  const [amount, setAmount] = useState('');
  const [panText, setPanText] = useState('');
  // One key per attempt: pressing again after a network error does not withdraw twice.
  const key = useRef(crypto.randomUUID());

  if (w.isPending) return <Spinner label={t('common.loading')} />;
  if (w.error) return <ErrorText error={w.error} />;
  const v = w.data;
  const paise = rupeesToPaise(amount);
  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow={t('wallet.eyebrow')}
        title={t('wallet.title')}
        subtitle={t('wallet.subtitle', { upi: v.upiHint })}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('wallet.balance')} value={formatPaise(v.balancePaise)} />
        <Stat label={t('wallet.todayLeft')} value={formatPaise(v.todayRemainingPaise)} />
        <Stat label={t('wallet.fyEarned', { fy: v.fy })} value={formatPaise(v.fyEarnedPaise)} />
      </div>
      {v.frozen && <Notice tone="danger">{t('wallet.frozen')}</Notice>}
      {(v.panPrompt || v.panRequired) && !v.panOnFile && (
        <Card className="space-y-3 p-5">
          <p className="font-semibold">
            {v.panRequired ? t('wallet.panRequired') : t('wallet.panPrompt')}
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              pan.mutate(panText.trim().toUpperCase());
            }}
          >
            <Input
              value={panText}
              onChange={(e) => setPanText(e.target.value.toUpperCase())}
              maxLength={10}
              aria-label={t('wallet.pan')}
              placeholder="ABCDE1234F" // i18n-ignore: format example
              className="mt-0 w-44"
            />
            <Button disabled={panText.length !== 10 || pan.isPending}>{t('wallet.savePan')}</Button>
          </form>
          <ErrorText error={pan.error} />
        </Card>
      )}
      <Card className="p-5">
        <h2 className="text-lg font-bold">{t('wallet.withdraw')}</h2>
        <p className="mb-4 text-sm text-muted">{t('wallet.withdrawHelp')}</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!paise) return;
            out.mutate(
              { amountPaise: paise, key: key.current },
              {
                onSuccess: () => {
                  setAmount('');
                  key.current = crypto.randomUUID();
                },
              },
            );
          }}
        >
          <Field label={t('wallet.amount')}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="₹"
              className="w-40"
            />
          </Field>
          <Button disabled={!paise || v.frozen || out.isPending}>{t('wallet.withdrawNow')}</Button>
        </form>
        <div className="mt-3">
          <ErrorText error={out.error} />
        </div>
      </Card>
      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-bold">{t('wallet.transfers')}</h2>
          {v.withdrawals.length === 0 && (
            <p className="text-sm text-muted">{t('wallet.noTransfers')}</p>
          )}
          <ul className="divide-y divide-line">
            {v.withdrawals.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-semibold tabular-nums">
                    {formatPaise(x.amountPaise - x.tdsPaise)}
                  </span>
                  {x.tdsPaise > 0 && (
                    <span className="text-muted">
                      {' '}
                      · {t('wallet.tds', { amount: formatPaise(x.tdsPaise) })}
                    </span>
                  )}
                  <span className="block text-xs text-muted">
                    {dateTimeIST(x.at)}
                    {x.utr && ` · UTR ${x.utr}`}
                  </span>
                </span>
                <Badge
                  tone={x.status === 'sent' ? 'emerald' : x.status === 'failed' ? 'danger' : 'gold'}
                >
                  {t(`wallet.status.${x.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-bold">{t('wallet.history')}</h2>
          <ul className="divide-y divide-line">
            {v.ledger.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {t(`wallet.reason.${l.reason}`)}
                  <span className="block text-xs text-muted">{dateTimeIST(l.at)}</span>
                </span>
                <span
                  className={
                    l.deltaPaise < 0
                      ? 'font-semibold text-danger tabular-nums'
                      : 'font-semibold text-emerald tabular-nums'
                  }
                >
                  {l.deltaPaise < 0 ? '−' : '+'}
                  {formatPaise(Math.abs(l.deltaPaise))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
