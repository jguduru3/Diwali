import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DOC_FILE_MAX_BYTES,
  DOC_NEEDS_EXPIRY,
  isValidGstin,
  type DocumentSubmit,
  type MerchantDocType,
  type ShopDocumentSlot,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { FilePicker } from '../../components/FilePicker';
import { Badge, Button, Card, Field, Input, Notice, Spinner, cx } from '../../components/ui';
import { shownStatus, type Shown } from '../../lib/documents';
import { dayIST } from '../../lib/format';
import { photoToJpegBase64 } from '../../lib/image';
import {
  ownDocumentUrl,
  useOwnDocuments,
  useShopScope,
  useSubmitDocument,
} from '../../lib/queries';

const tone: Record<Shown, 'emerald' | 'gold' | 'danger' | 'muted' | 'saffron'> = {
  verified: 'emerald',
  pending: 'gold',
  rejected: 'danger',
  expired: 'saffron',
  missing: 'muted',
};

export function DocStatusBadge({ status }: { status: Shown }) {
  const { t } = useTranslation();
  return <Badge tone={tone[status]}>{t(`documents.status.${status}`)}</Badge>;
}

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/** PDFs are sent as they are; photos are shrunk to a JPEG first. */
async function fileToUpload(file: File): Promise<DocumentSubmit['file'] | 'tooBig' | 'badType'> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (file.size > DOC_FILE_MAX_BYTES) return 'tooBig';
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { contentType: 'application/pdf', base64: btoa(binary) };
  }
  if (!file.type.startsWith('image/')) return 'badType';
  const base64 = await photoToJpegBase64(file);
  if ((base64.length * 3) / 4 > DOC_FILE_MAX_BYTES) return 'tooBig';
  return { contentType: 'image/jpeg', base64 };
}

function UploadForm({
  docType,
  onDone,
  onCancel,
}: {
  docType: MerchantDocType;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const submit = useSubmitDocument();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ docNumber: '', issuedBy: '', validFrom: '', validTo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsExpiry = DOC_NEEDS_EXPIRY[docType];
  const isGst = docType === 'gst_certificate';
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (isGst && !isValidGstin(f.docNumber)) return setErr(t('documents.gstinInvalid'));
    if (f.docNumber.trim().length < 3) return setErr(t('documents.numberRequired'));
    if (needsExpiry && !f.validTo) return setErr(t('documents.validToRequired'));
    if (f.validFrom && f.validTo && f.validFrom > f.validTo)
      return setErr(t('documents.datesOrder'));
    if (!file) return setErr(t('documents.needFile'));
    setBusy(true);
    try {
      const upload = await fileToUpload(file);
      if (upload === 'tooBig') return setErr(t('documents.tooBig'));
      if (upload === 'badType') return setErr(t('documents.badType'));
      submit.mutate(
        {
          docType,
          docNumber: f.docNumber.trim(),
          issuedBy: f.issuedBy.trim() || undefined,
          validFrom: f.validFrom || undefined,
          validTo: f.validTo || undefined,
          file: upload,
        },
        { onSuccess: onDone },
      );
    } catch {
      setErr(t('documents.badType'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2"
      noValidate
    >
      <Field
        label={isGst ? t('documents.gstin') : t('documents.number')}
        hint={isGst ? t('documents.gstinHint') : undefined}
      >
        <Input
          required
          value={f.docNumber}
          onChange={set('docNumber')}
          autoCapitalize={isGst ? 'characters' : undefined}
          maxLength={isGst ? 15 : 60}
        />
      </Field>
      <Field label={t('documents.issuedBy')}>
        <Input
          value={f.issuedBy}
          onChange={set('issuedBy')}
          placeholder={t(`documents.issuer.${docType}`)}
        />
      </Field>
      <Field label={t('documents.validFrom')}>
        <Input type="date" value={f.validFrom} onChange={set('validFrom')} />
      </Field>
      <Field label={needsExpiry ? t('documents.validTo') : t('documents.validToOptional')}>
        <Input type="date" required={needsExpiry} value={f.validTo} onChange={set('validTo')} />
      </Field>
      <Field
        label={t('documents.file')}
        hint={file ? `${file.name} · ${kb(file.size)}` : t('documents.fileHint')}
        className="sm:col-span-2"
      >
        <FilePicker
          accept="application/pdf,image/*"
          fileName={file?.name}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <div className="space-y-3 sm:col-span-2">
        {err && <Notice tone="danger">{err}</Notice>}
        <ErrorText error={submit.error} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || submit.isPending}>
            {busy || submit.isPending ? t('documents.uploading') : t('documents.send')}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function DocumentCard({ slot }: { slot: ShopDocumentSlot }) {
  const { t } = useTranslation();
  const scope = useShopScope();
  const [open, setOpen] = useState(false);
  const doc = slot.current;
  const status = shownStatus(doc);
  return (
    <Card as="li" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{t(`documents.type.${slot.docType}`)}</h3>
          <p className="text-sm text-muted">{t(`documents.about.${slot.docType}`)}</p>
        </div>
        <DocStatusBadge status={status} />
      </div>

      {doc && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div className="col-span-2">
            <dt className="text-xs font-semibold text-muted">
              {slot.docType === 'gst_certificate' ? t('documents.gstin') : t('documents.number')}
            </dt>
            <dd className="font-semibold break-all">{doc.docNumber}</dd>
          </div>
          {doc.issuedBy && (
            <div className="col-span-2">
              <dt className="text-xs font-semibold text-muted">{t('documents.issuedBy')}</dt>
              <dd>{doc.issuedBy}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold text-muted">{t('documents.validFrom')}</dt>
            <dd>{doc.validFrom ? dayIST(doc.validFrom) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">{t('documents.validToShort')}</dt>
            <dd className={cx(doc.isExpired && 'font-semibold text-saffron')}>
              {doc.validTo ? dayIST(doc.validTo) : t('documents.noExpiry')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">{t('documents.uploaded')}</dt>
            <dd>{dayIST(doc.uploadedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">{t('documents.fileShort')}</dt>
            <dd>
              <a
                href={ownDocumentUrl(doc.id, scope.q())}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-plum underline-offset-4 hover:underline"
              >
                {doc.contentType === 'application/pdf' ? 'PDF' : t('documents.photo')} ·{' '}
                {kb(doc.sizeBytes)}
              </a>
            </dd>
          </div>
        </dl>
      )}

      {doc?.status === 'rejected' && doc.notes && (
        <Notice tone="danger" className="mt-4">
          {t('documents.rejectedBecause', { reason: doc.notes })}
        </Notice>
      )}
      {status === 'expired' && <Notice className="mt-4">{t('documents.expiredHint')}</Notice>}
      {slot.replacedCount > 0 && (
        <p className="mt-3 text-xs text-muted">
          {t('documents.replacedCount', { count: slot.replacedCount })}
        </p>
      )}

      {open || !doc ? (
        <UploadForm
          key={doc?.id ?? 'new'}
          docType={slot.docType}
          onDone={() => setOpen(false)}
          onCancel={doc ? () => setOpen(false) : undefined}
        />
      ) : (
        <div className="mt-4">
          <Button
            size="sm"
            variant={status === 'rejected' || status === 'expired' ? 'primary' : 'secondary'}
            onClick={() => setOpen(true)}
          >
            {t('documents.replace')}
          </Button>
          {doc.status === 'verified' && !doc.isExpired && (
            <span className="ml-3 text-xs text-muted">{t('documents.replaceVerifiedHint')}</span>
          )}
        </div>
      )}
    </Card>
  );
}

/** Five business documents besides the trading licence, each checked by the platform team. */
export function Documents() {
  const { t } = useTranslation();
  const list = useOwnDocuments();
  if (list.isPending) return <Spinner label={t('common.loading')} />;
  if (list.error) return <ErrorText error={list.error} />;
  const verified = list.data.filter((s) => shownStatus(s.current) === 'verified').length;
  const total = list.data.length;
  return (
    <section className="space-y-4" aria-labelledby="documents-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="documents-title" className="text-xl font-bold">
            {t('documents.title')}
          </h2>
          <p className="text-sm text-muted">{t('documents.subtitle')}</p>
        </div>
        <div className="min-w-48">
          <p className="text-[13px] font-semibold text-muted tabular-nums">
            {t('documents.progress', { verified, total })}
          </p>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-sand"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={verified}
            aria-label={t('documents.progress', { verified, total })}
          >
            <div
              className="h-full rounded-full bg-emerald"
              style={{ width: `${(verified / total) * 100}%` }}
            />
          </div>
        </div>
      </div>
      <ul className="grid gap-4 xl:grid-cols-2">
        {list.data.map((slot) => (
          <DocumentCard key={slot.docType} slot={slot} />
        ))}
      </ul>
    </section>
  );
}
