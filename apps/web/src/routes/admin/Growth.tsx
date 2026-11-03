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
  useAdminInfluencers,
  useAdminPayouts,
  useAdminSettlements,
  useAdminSubscriptions,
  useAdminWithdrawals,
} from '../../lib/growth';

const tone = (s: string) =>
  ['active', 'paid', 'sent', 'credited'].includes(s)
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
  const influencers = useAdminInfluencers(f.status);
  const act = useAdminAct();
  return (
    <div className="space-y-5">
      {f.control}
      <ErrorText error={agents.error ?? influencers.error ?? act.error} />
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
                  {a.recruitedBy && ` · ${a.recruitedBy}`}
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
      <h2 className="text-lg font-bold">{t('admin.influencers')}</h2>
      <ul className="grid gap-3 lg:grid-cols-2">
        {influencers.data?.map((i) => (
          <Card as="li" key={i.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  {i.handle} · {i.code}
                </p>
                <p className="text-sm text-muted">
                  {t(`influencer.platforms.${i.platform}`)} ·{' '}
                  {t('admin.referred', { count: i.referred })}
                </p>
              </div>
              <Badge tone={tone(i.status)}>{t(`growthStatus.${i.status}`)}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {i.status !== 'active' && (
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => act.mutate({ path: `influencers/${i.id}/approve` })}
                >
                  {t('admin.approve')}
                </Button>
              )}
              {i.status !== 'suspended' && (
                <Ask
                  label={t('admin.reason')}
                  action={t('admin.suspend')}
                  onSubmit={(reason) =>
                    act.mutate({ path: `influencers/${i.id}/suspend`, body: { reason } })
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

export function AdminPayouts() {
  const { t } = useTranslation();
  const f = useStatusFilter(['requested', 'sent', 'failed'], 'requested');
  const list = useAdminWithdrawals(f.status);
  const payouts = useAdminPayouts();
  const act = useAdminAct();
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t('admin.payoutsHelp')}</p>
      {f.control}
      <ErrorText error={list.error ?? act.error} />
      {list.data?.length === 0 && <EmptyState title={t('admin.none')} />}
      <ul className="grid gap-3 lg:grid-cols-2">
        {list.data?.map((w) => (
          <Card as="li" key={w.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold tabular-nums">
                  {t('admin.payTo', { amount: formatPaise(w.payPaise), upi: w.upiHint })}
                </p>
                <p className="text-sm text-muted">
                  {w.who} · {dateTimeIST(w.createdAt)}
                  {w.tdsPaise > 0 && ` · ${t('wallet.tds', { amount: formatPaise(w.tdsPaise) })}`}
                </p>
                {w.utr && <p className="text-xs text-muted">UTR {w.utr}</p>}
              </div>
              <Badge tone={tone(w.status)}>{t(`growthStatus.${w.status}`)}</Badge>
            </div>
            {w.status === 'requested' && (
              <div className="space-y-2">
                <Ask
                  label={t('admin.utr')}
                  action={t('admin.markSent')}
                  pattern={/^[0-9A-Za-z]{6,30}$/}
                  onSubmit={(utr) =>
                    act.mutate({ path: `withdrawals/${w.id}/sent`, body: { utr } })
                  }
                />
                <Ask
                  label={t('admin.reason')}
                  action={t('admin.markFailed')}
                  onSubmit={(reason) =>
                    act.mutate({ path: `withdrawals/${w.id}/failed`, body: { reason } })
                  }
                />
              </div>
            )}
          </Card>
        ))}
      </ul>
      <h2 className="text-lg font-bold">{t('admin.agentPayouts')}</h2>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {payouts.data?.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <span>
              {p.agentCode} · {p.shopCode} ·{' '}
              <span className="tabular-nums">{formatPaise(p.amountPaise)}</span> ·{' '}
              {dateTimeIST(p.at)}
            </span>
            {p.status === 'credited' ? (
              <Ask
                label={t('admin.reason')}
                action={t('admin.reverse')}
                onSubmit={(reason) =>
                  act.mutate({ path: `payouts/${p.id}/reverse`, body: { reason } })
                }
              />
            ) : (
              <Badge tone="danger">{t('growthStatus.reversed')}</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminSettlements() {
  const { t } = useTranslation();
  const f = useStatusFilter(['pending', 'paid'], 'pending');
  const list = useAdminSettlements(f.status);
  const subs = useAdminSubscriptions('');
  const act = useAdminAct();
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">{t('admin.settlements')}</h2>
      <p className="text-sm text-muted">{t('admin.settlementsHelp')}</p>
      {f.control}
      <ErrorText error={list.error ?? act.error} />
      {list.data?.length === 0 && <EmptyState title={t('admin.none')} />}
      <ul className="grid gap-3 lg:grid-cols-2">
        {list.data?.map((s) => (
          <Card as="li" key={s.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  {s.shopName} · {s.shopCode}
                </p>
                <p className="text-sm text-muted tabular-nums">
                  {formatPaise(s.amountPaise)} · {t('settle.bills', { count: s.bills })} ·{' '}
                  {s.upiHint ?? t('admin.noUpi')}
                </p>
              </div>
              <Badge tone={tone(s.status)}>{t(`growthStatus.${s.status}`)}</Badge>
            </div>
            {s.status === 'pending' && (
              <Ask
                label={t('admin.utr')}
                action={t('admin.markPaid')}
                pattern={/^[0-9A-Za-z]{6,30}$/}
                onSubmit={(utr) => act.mutate({ path: `settlements/${s.id}/paid`, body: { utr } })}
              />
            )}
          </Card>
        ))}
      </ul>
      <h2 className="text-lg font-bold">{t('admin.subscriptions')}</h2>
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
