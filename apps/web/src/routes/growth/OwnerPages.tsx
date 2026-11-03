import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  PageTitle,
  Spinner,
  Textarea,
} from '../../components/ui';
import { useOwnerApprove, useReview, useReviewAct } from '../../lib/growth';
import { TermsCheck } from './TermsCheck';

/** /m/approve/TOKEN — the owner agrees that the agent may set up their shop. */
export function OwnerApprovePage() {
  const { t } = useTranslation();
  const token = useParams().token ?? '';
  const approve = useOwnerApprove();
  return (
    <Card className="mx-auto max-w-lg space-y-4 p-6 sm:p-8">
      <h1 className="text-2xl font-extrabold">{t('owner.consentTitle')}</h1>
      <p className="text-muted">{t('owner.consentBody')}</p>
      <Notice tone="danger">{t('owner.neverCash')}</Notice>
      {approve.isSuccess ? (
        <Notice tone="emerald">{t('owner.consentDone')}</Notice>
      ) : (
        <Button onClick={() => approve.mutate(token)} disabled={approve.isPending}>
          {t('owner.iAgree')}
        </Button>
      )}
      <ErrorText error={approve.error} />
    </Card>
  );
}

/** /m/review/TOKEN — the owner checks the shop the agent set up, then approves and pays. */
export function OwnerReviewPage() {
  const { t } = useTranslation();
  const token = useParams().token ?? '';
  const review = useReview(token);
  const act = useReviewAct(token);
  const [terms, setTerms] = useState(false);
  const [note, setNote] = useState('');
  if (review.isPending) return <Spinner label={t('common.loading')} />;
  if (review.error)
    return <EmptyState title={t('owner.linkInvalid')} body={<ErrorText error={review.error} />} />;
  const r = review.data;
  const done = r.status === 'approved' || r.status === 'live';
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle
        eyebrow={t('owner.eyebrow')}
        title={r.shopName}
        subtitle={t('owner.reviewSubtitle', { agent: r.agentCode ?? '—' })}
      />
      {done && <Notice tone="emerald">{t('owner.approvedNote')}</Notice>}
      {r.status === 'closed' && <Notice tone="danger">{t('owner.closedNote')}</Notice>}
      <Card className="p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-muted">{t('agent.area')}</dt>
            <dd>{r.area}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">{t('documents.gstin')}</dt>
            <dd>{r.gstin ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">{t('owner.hours')}</dt>
            <dd>{r.openFrom && r.openTo ? `${r.openFrom}–${r.openTo}` : '—'}</dd>
          </div>
        </dl>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-bold">
          {t('owner.priceList', { count: r.items.length })}
        </h2>
        <ul className="divide-y divide-line">
          {r.items.map((i, n) => (
            <li key={n} className="flex items-center gap-3 py-2 text-sm">
              {i.imageUrl ? (
                <img src={i.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="h-10 w-10 rounded-lg bg-ivory" />
              )}
              <span className="flex-1">
                {i.name}
                {i.packDesc && <span className="text-muted"> · {i.packDesc}</span>}
              </span>
              <span className="font-semibold tabular-nums">{formatPaise(i.pricePaise)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {r.status === 'review' && (
        <Card className="space-y-4 p-5">
          <h2 className="text-lg font-bold">{t('owner.approveTitle')}</h2>
          <p className="text-sm">
            {t('owner.price', {
              amount: formatPaise(r.amountPaise),
              gst: formatPaise(r.gstPaise),
              total: formatPaise(r.amountPaise + r.gstPaise),
            })}
          </p>
          <TermsCheck party="merchant" checked={terms} onChange={setTerms} />
          {r.subscription?.status === 'pending' && r.subscription.method === 'offline' && (
            <Notice>
              {t('owner.offlineInstructions', {
                reference: r.subscription.reference,
                total: formatPaise(r.amountPaise + r.gstPaise),
              })}
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            {r.subscription?.status === 'pending' && r.subscription.checkoutUrl ? (
              <ButtonLink to={r.subscription.checkoutUrl}>{t('owner.payNow')}</ButtonLink>
            ) : (
              <Button
                disabled={!terms || act.isPending}
                onClick={() =>
                  act.mutate({ kind: 'approve', body: { acceptTerms: true, method: 'online' } })
                }
              >
                {t('owner.approvePay', { total: formatPaise(r.amountPaise + r.gstPaise) })}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={!terms || act.isPending}
              onClick={() =>
                act.mutate({ kind: 'approve', body: { acceptTerms: true, method: 'offline' } })
              }
            >
              {t('owner.payBank')}
            </Button>
          </div>
          <div className="space-y-2 border-t border-line pt-4">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={t('owner.note')}
              placeholder={t('owner.note')}
              rows={2}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={note.trim().length < 3}
                onClick={() => act.mutate({ kind: 'changes', body: { note } })}
              >
                {t('owner.askChanges')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={note.trim().length < 3}
                onClick={() => act.mutate({ kind: 'decline', body: { note } })}
              >
                {t('owner.decline')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                disabled={note.trim().length < 3}
                onClick={() => act.mutate({ kind: 'report', body: { note } })}
              >
                {t('owner.report')}
              </Button>
            </div>
          </div>
          <Notice tone="danger">{t('owner.neverCash')}</Notice>
          <ErrorText error={act.error} />
        </Card>
      )}
      {r.subscription && (
        <Badge tone={r.subscription.status === 'paid' ? 'emerald' : 'gold'}>
          {t(`owner.sub.${r.subscription.status}`)}
        </Badge>
      )}
    </div>
  );
}
