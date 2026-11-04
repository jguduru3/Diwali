import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Button, Card, EmptyState, Input, Segmented, Spinner } from '../../components/ui';
import { dateTimeIST } from '../../lib/format';
import {
  useAdminAct,
  useAdminAgents,
  useAdminFeedback,
  useAdminPayouts,
  useAdminSubscriptions,
} from '../../lib/growth';

const tone = (s: string) =>
  ['active', 'paid', 'sent'].includes(s)
    ? 'emerald'
    : ['suspended', 'failed', 'reversed', 'cancelled'].includes(s)
      ? 'danger'
      : 'gold';

/** A text box plus a button; the button needs the text (UTR, reason, reference). */
function Ask({
  label,
  action,
  onSubmit,
  pattern = /.{3,}/,
}: {
  label: string;
  action: string;
  onSubmit: (v: string) => void;
  pattern?: RegExp;
}) {
  const [v, setV] = useState('');
  return (
    <div className="flex flex-wrap gap-2">
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label={label}
        placeholder={label}
        className="mt-0 w-48"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!pattern.test(v.trim())}
        onClick={() => onSubmit(v.trim())}
      >
        {action}
      </Button>
    </div>
  );
}

function useStatusFilter<T extends string>(values: T[], initial: T | '') {
  const { t } = useTranslation();
  const [status, setStatus] = useState<T | ''>(initial);
  const control = (
    <Segmented<T | ''>
      label={t('admin.filter')}
      value={status}
      onChange={setStatus}
      options={[...values, ''].map((v) => ({
        value: v as T | '',
        label: v ? t(`growthStatus.${v}`) : t('shopPage.all'),
      }))}
    />
  );
  return { status, control };
}

export function AdminAgents() {
  const { t } = useTranslation();
  const f = useStatusFilter(['pending', 'active', 'suspended'], 'pending');
  const agents = useAdminAgents(f.status);
  const act = useAdminAct();
  return (
    <div className="space-y-5">
      {f.control}
      <ErrorText error={agents.error ?? act.error} />
      <h2 className="text-lg font-bold">{t('admin.agents')}</h2>
      {agents.isPending && <Spinner label={t('common.loading')} />}
      {agents.data?.length === 0 && <EmptyState title={t('admin.none')} />}
      <ul className="grid gap-3 lg:grid-cols-2">
        {agents.data?.map((a) => (
          <Card as="li" key={a.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  {a.name} · {a.code}
                </p>
                <p className="text-sm text-muted">
                  {a.phoneMasked} ·{' '}
                  {t('admin.agentStats', { merchants: a.merchants, live: a.live })}
                </p>
              </div>
              <Badge tone={tone(a.status)}>{t(`growthStatus.${a.status}`)}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {a.status !== 'active' && (
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => act.mutate({ path: `agents/${a.id}/approve` })}
                >
                  {t('admin.approve')}
                </Button>
              )}
              {a.status !== 'suspended' && (
                <Ask
                  label={t('admin.reason')}
                  action={t('admin.suspend')}
                  onSubmit={(reason) =>
                    act.mutate({ path: `agents/${a.id}/suspend`, body: { reason } })
                  }
                />
              )}
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}

/** Each ₹1,000 goes from the payout account straight to the agent's UPI ID; the UTR is kept. */
export function AdminPayouts() {
  const { t } = useTranslation();
  const f = useStatusFilter(['pending', 'sent', 'failed', 'reversed'], 'pending');
  const list = useAdminPayouts(f.status);
  const act = useAdminAct();
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t('admin.payoutsHelp')}</p>
      {f.control}
      <ErrorText error={list.error ?? act.error} />
      {list.isPending && <Spinner label={t('common.loading')} />}
      {list.data?.length === 0 && <EmptyState title={t('admin.none')} />}
      <ul className="grid gap-3 lg:grid-cols-2">
        {list.data?.map((p) => (
          <Card as="li" key={p.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold tabular-nums">
                  {t('admin.payTo', { amount: formatPaise(p.netPaise), upi: p.upiHint })}
                </p>
                <p className="text-sm text-muted">
                  {p.agentName} · {p.agentCode} · {p.phoneMasked}
                </p>
                <p className="text-sm text-muted">
                  {p.shopName} · {p.shopCode} · {dateTimeIST(p.earnedAt)}
                  {p.tdsPaise > 0 &&
                    ` · ${t('agent.payouts.tds', { amount: formatPaise(p.tdsPaise) })}`}
                </p>
                {p.utr && <p className="text-xs text-muted">UTR {p.utr}</p>}
                {p.failureReason && (
                  <p className="text-xs text-danger">
                    {p.failureReason}
                    {p.failedAttempts > 1 && ` (${p.failedAttempts})`}
                  </p>
                )}
              </div>
              <Badge tone={p.blocked ? 'saffron' : tone(p.status)}>
                {p.blocked ? t('admin.blockedPan') : t(`growthStatus.${p.status}`)}
              </Badge>
            </div>
            {p.status === 'pending' && !p.blocked && (
              <div className="space-y-2">
                <Ask
                  label={t('admin.utr')}
                  action={t('admin.markSent')}
                  pattern={/^[0-9A-Za-z]{6,30}$/}
                  onSubmit={(utr) => act.mutate({ path: `payouts/${p.id}/sent`, body: { utr } })}
                />
                <Ask
                  label={t('admin.reason')}
                  action={t('admin.markFailed')}
                  onSubmit={(reason) =>
                    act.mutate({ path: `payouts/${p.id}/failed`, body: { reason } })
                  }
                />
              </div>
            )}
            {p.status === 'failed' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act.mutate({ path: `payouts/${p.id}/retry` })}
              >
                {t('admin.retry')}
              </Button>
            )}
            {p.status !== 'reversed' && (
              <Ask
                label={t('admin.reason')}
                action={t('admin.reverse')}
                onSubmit={(reason) =>
                  act.mutate({ path: `payouts/${p.id}/reverse`, body: { reason } })
                }
              />
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}

export function AdminSubscriptions() {
  const { t } = useTranslation();
  const subs = useAdminSubscriptions('');
  const act = useAdminAct();
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">{t('admin.subscriptions')}</h2>
      <ErrorText error={subs.error ?? act.error} />
      {subs.data?.length === 0 && <EmptyState title={t('admin.none')} />}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {subs.data?.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <span>
              {s.shopName} · {s.reference} ·{' '}
              <span className="tabular-nums">{formatPaise(s.totalPaise)}</span> ·{' '}
              {t(`admin.method.${s.method}`)}
              {s.invoiceNo && ` · ${s.invoiceNo}`}
            </span>
            {s.status === 'pending' && s.method === 'offline' ? (
              <Ask
                label={t('admin.bankRef')}
                action={t('admin.markPaid')}
                pattern={/.{4,}/}
                onSubmit={(reference) =>
                  act.mutate({ path: `subscriptions/${s.id}/paid-offline`, body: { reference } })
                }
              />
            ) : (
              <Badge tone={tone(s.status)}>{t(`growthStatus.${s.status}`)}</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminFeedback() {
  const { t } = useTranslation();
  const list = useAdminFeedback();
  const yes = list.data?.filter((f) => f.helped).length ?? 0;
  return (
    <div className="space-y-4">
      {list.data && (
        <p className="text-lg font-bold">
          {t('admin.feedbackSummary', { yes, total: list.data.length })}
        </p>
      )}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {list.data?.map((f, i) => (
          <li key={i} className="px-4 py-3 text-sm">
            <Badge tone={f.helped ? 'emerald' : 'danger'}>
              {f.helped ? t('agent.yes') : t('agent.no')}
            </Badge>{' '}
            {f.agentCode} · {f.shopCode} · {dateTimeIST(f.at)}
            {f.note && <p className="mt-1 text-muted">“{f.note}”</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
