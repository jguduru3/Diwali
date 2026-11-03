import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, EmptyState, Input, Segmented, Spinner } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useAdminLicences, useDecideLicence } from '../../lib/queries';
import { LicenceBadge } from '../shop/Licence';

type Filter = 'pending' | 'verified' | 'rejected' | 'expired' | '';

/** Pending licences queue with the private photo, verify / reject. */
export function Licences() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('pending');
  const list = useAdminLicences(filter);
  const decide = useDecideLicence();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <Segmented<Filter>
        label={t('admin.tabs.licences')}
        value={filter}
        onChange={setFilter}
        options={(['pending', 'verified', 'rejected', 'expired', ''] as Filter[]).map((f) => ({
          value: f,
          label: f ? t(`licence.status.${f}`) : t('shopPage.all'),
        }))}
      />
      {list.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={list.error ?? decide.error} />
      {list.data?.length === 0 && <EmptyState icon="✓" title={t('admin.noLicences')} />}
      <ul className="grid gap-4 lg:grid-cols-2">
        {list.data?.map((l) => (
          <Card as="li" key={l.id} className="overflow-hidden">
            <button
              type="button"
              className="block h-48 w-full bg-sand"
              onClick={() => setZoom(zoom === l.id ? null : l.id)}
              aria-label={t('admin.viewPhoto')}
            >
              {l.hasImage && (
                <img
                  src={`/api/console/licences/${l.id}/image`}
                  alt={t('admin.licencePhoto', { shop: l.shopName })}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              )}
            </button>
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold">{l.shopName}</p>
                  <p className="text-sm text-muted">
                    {l.shopCode} · {l.licenceNo} · {l.licenceType}
                  </p>
                  <p className="text-sm">
                    {t('licence.valid', {
                      from: l.validFrom ? dayIST(l.validFrom) : '—',
                      to: dayIST(l.validTo),
                    })}
                  </p>
                  {l.issuedBy && <p className="text-sm text-muted">{l.issuedBy}</p>}
                </div>
                <LicenceBadge status={l.status} />
              </div>
              {l.status === 'pending' && (
                <>
                  <Input
                    placeholder={t('admin.notes')}
                    aria-label={t('admin.notes')}
                    value={notes[l.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })}
                    className="mt-0"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="success"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: l.id, decision: 'verify', notes: notes[l.id] })
                      }
                    >
                      ✓ {t('admin.verify')}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: l.id, decision: 'reject', notes: notes[l.id] })
                      }
                    >
                      {t('admin.reject')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted">{t('admin.verifyHelp')}</p>
                </>
              )}
            </div>
          </Card>
        ))}
      </ul>
      {zoom && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 z-50 grid place-items-center bg-night/80 p-4"
          onClick={() => setZoom(null)}
        >
          <img
            src={`/api/console/licences/${zoom}/image`}
            alt={t('admin.viewPhoto')}
            className="max-h-[90vh] max-w-full rounded-2xl bg-white"
          />
        </div>
      )}
    </div>
  );
}
