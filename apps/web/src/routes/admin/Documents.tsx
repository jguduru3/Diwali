import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocStatus } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, EmptyState, Input, Segmented, Spinner } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useAdminDocuments, useDecideDocument } from '../../lib/queries';
import { shownStatus } from '../../lib/documents';
import { DocStatusBadge } from '../shop/Documents';

type Filter = DocStatus | '';

/** Merchant documents queue: open the private file, verify, or reject with a reason. */
export function AdminDocuments() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('pending');
  const list = useAdminDocuments(filter);
  const decide = useDecideDocument();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [needReason, setNeedReason] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <Segmented<Filter>
        label={t('admin.tabs.documents')}
        value={filter}
        onChange={setFilter}
        options={(['pending', 'verified', 'rejected', ''] as Filter[]).map((f) => ({
          value: f,
          label: f ? t(`documents.status.${f}`) : t('shopPage.all'),
        }))}
      />
      {list.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={list.error ?? decide.error} />
      {list.data?.length === 0 && <EmptyState icon="✓" title={t('documents.adminEmpty')} />}
      <ul className="grid gap-4 lg:grid-cols-2">
        {list.data?.map((d) => (
          <Card as="li" key={d.id} className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gold-deep">
                  {d.shopName} · {d.shopCode}
                </p>
                <h3 className="text-lg font-bold">{t(`documents.type.${d.docType}`)}</h3>
                <p className="text-sm font-semibold break-all">{d.docNumber}</p>
                {d.issuedBy && <p className="text-sm text-muted">{d.issuedBy}</p>}
                <p className="text-sm text-muted">
                  {t('documents.validRange', {
                    from: d.validFrom ? dayIST(d.validFrom) : '—',
                    to: d.validTo ? dayIST(d.validTo) : t('documents.noExpiry'),
                  })}
                  {' · '}
                  {t('documents.uploadedOn', { date: dayIST(d.uploadedAt) })}
                </p>
              </div>
              <DocStatusBadge status={shownStatus(d)} />
            </div>
            <a
              href={`/api/console/documents/${d.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center rounded-xl border border-line-strong px-3 text-[13px] font-semibold text-ink hover:bg-ivory"
            >
              {t('documents.openFile', {
                kind: d.contentType === 'application/pdf' ? 'PDF' : t('documents.photo'),
              })}
            </a>
            {d.notes && <p className="text-sm text-muted">“{d.notes}”</p>}
            {(d.status === 'pending' || d.status === 'verified') && (
              <div className="space-y-2 border-t border-line pt-4">
                <Input
                  placeholder={
                    d.status === 'pending' ? t('admin.notes') : t('documents.revokeReason')
                  }
                  aria-label={t('admin.notes')}
                  value={notes[d.id] ?? ''}
                  onChange={(e) => {
                    setNotes({ ...notes, [d.id]: e.target.value });
                    if (needReason === d.id) setNeedReason(null);
                  }}
                  className="mt-0"
                />
                {needReason === d.id && (
                  <p className="text-sm text-danger">{t('documents.reasonRequired')}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {d.status === 'pending' && (
                    <Button
                      variant="success"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: d.id, decision: 'verify', notes: notes[d.id] })
                      }
                    >
                      ✓ {t('admin.verify')}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    disabled={decide.isPending}
                    onClick={() => {
                      const reason = (notes[d.id] ?? '').trim();
                      if (reason.length < 3) return setNeedReason(d.id);
                      decide.mutate({ id: d.id, decision: 'reject', notes: reason });
                    }}
                  >
                    {d.status === 'pending' ? t('admin.reject') : t('documents.revoke')}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}
