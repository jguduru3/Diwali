import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  formatOrderCode,
  formatPaise,
  istDate,
  staffPhoneMask,
  type MerchantPaymentSettingsView,
  type SalesRecordItem,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  PageTitle,
  Select,
  Spinner,
  Stat,
  Toggle,
  cx,
} from '../../components/ui';
import { dateTimeIST, itemName } from '../../lib/format';
import {
  useDeletePaymentQr,
  usePaymentSettings,
  useSavePaymentSettings,
  useShopAnalytics,
  useShopScope,
  useUploadPaymentQr,
} from '../../lib/queries';

/**
 * How a merchant takes counter payments: PhonePe/UPI QR code, UPI through
 * YouPI-PG, card machine, cash. Used by the owner (shop app) and by the
 * platform team when onboarding a merchant (admin → shops, pass `shopId`).
 */
export function PaymentSettingsForm({ shopId }: { shopId?: string }) {
  const { t } = useTranslation();
  const current = usePaymentSettings(shopId);
  const save = useSavePaymentSettings(shopId);
  const uploadQr = useUploadPaymentQr(shopId);
  const deleteQr = useDeletePaymentQr(shopId);

  const [f, setF] = useState<MerchantPaymentSettingsView | null>(null);
  const [secret, setSecret] = useState('');
  const [qrFileError, setQrFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (current.data) setF(current.data);
  }, [current.data]);

  if (current.isPending || !f) return <Spinner label={t('common.loading')} />;

  const set =
    (k: 'youpiBaseUrl' | 'youpiMerchantId' | 'upiVpa') => (e: { target: { value: string } }) =>
      setF({ ...f, [k]: e.target.value });

  const handleQrFile = (e: ChangeEvent<HTMLInputElement>) => {
    setQrFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setQrFileError(t('payments.qrInvalidFormat'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setQrFileError(t('payments.qrFileTooLarge'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      uploadQr.mutate(
        {
          base64: result,
          contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        },
        {
          onSuccess: (data) => {
            setF(data);
            if (fileInputRef.current) fileInputRef.current.value = '';
          },
        },
      );
    };
    reader.onerror = () => {
      setQrFileError(t('payments.bad_image', 'Failed to read image file.'));
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteQr = () => {
    if (window.confirm(t('payments.qrDeleteConfirm'))) {
      deleteQr.mutate(undefined, {
        onSuccess: (data) => setF(data),
      });
    }
  };

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
        qrActive: f.qrActive ?? true,
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
    <div className="space-y-8">
      {/* 1. PhonePe / UPI Merchant QR Code Section */}
      <section className="space-y-4 rounded-3xl border border-line bg-surface p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">{t('payments.qrTitle')}</h3>
            <p className="mt-0.5 text-sm text-muted">{t('payments.qrSubtitle')}</p>
          </div>
          {f.qrImageUrl ? (
            f.qrActive !== false ? (
              <Badge tone="emerald">{t('payments.qrActiveBadge')}</Badge>
            ) : (
              <Badge tone="muted">{t('payments.qrInactiveBadge')}</Badge>
            )
          ) : (
            <Badge tone="rose">{t('payments.qrNotConfigured')}</Badge>
          )}
        </div>

        {f.qrImageUrl ? (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="w-fit rounded-2xl border border-line bg-white p-3 shadow-xs">
              <img
                src={f.qrImageUrl}
                alt={t('payments.qrTitle')}
                className="h-48 w-48 rounded-xl object-contain"
              />
              {f.qrUploadedAt && (
                <p className="mt-2 text-center text-xs text-muted">
                  {t('payments.qrUploadedAt', { time: dateTimeIST(f.qrUploadedAt) })}
                </p>
              )}
            </div>

            <div className="flex-1 space-y-4">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <Toggle
                  checked={f.qrActive !== false}
                  label={t('payments.qrEnable')}
                  disabled={save.isPending}
                  onChange={(active) => {
                    setF({ ...f, qrActive: active });
                    save.mutate({
                      youpiBaseUrl: f.youpiBaseUrl?.trim() || null,
                      youpiMerchantId: f.youpiMerchantId?.trim() || null,
                      upiVpa: f.upiVpa?.trim() || null,
                      acceptsCard: f.acceptsCard,
                      acceptsCash: f.acceptsCash,
                      qrActive: active,
                    });
                  }}
                />
                {t('payments.qrEnable')}
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleQrFile}
                  disabled={uploadQr.isPending}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploadQr.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadQr.isPending ? t('common.loading') : `📷 ${t('payments.qrReplaceBtn')}`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10"
                  disabled={deleteQr.isPending}
                  onClick={handleDeleteQr}
                >
                  {deleteQr.isPending ? t('common.loading') : `🗑 ${t('payments.qrDeleteBtn')}`}
                </Button>
              </div>

              <p className="text-xs text-muted">{t('payments.qrUploadPrompt')}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-sand/40 p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/20 text-2xl">
              📱
            </div>
            <p className="text-sm font-medium text-ink">{t('payments.qrNotConfigured')}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">
              {t('payments.qrNotConfiguredDesc')}
            </p>
            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleQrFile}
                disabled={uploadQr.isPending}
              />
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={uploadQr.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadQr.isPending ? t('common.loading') : `📤 ${t('payments.qrUploadBtn')}`}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">{t('payments.qrUploadPrompt')}</p>
          </div>
        )}

        {qrFileError && <p className="text-sm text-danger">{qrFileError}</p>}
        <ErrorText error={uploadQr.error ?? deleteQr.error} />
        {uploadQr.isSuccess && <Notice tone="emerald">{t('payments.saved')}</Notice>}
      </section>

      {/* 2. Counter Payment Methods Form (Card, Cash, YouPI-PG) */}
      <form onSubmit={submit} className="space-y-6">
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

        <div className="flex flex-wrap gap-6 pt-2">
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
    </div>
  );
}

type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom';

export function PaymentHistory() {
  const { t } = useTranslation();
  const shopScope = useShopScope();
  const today = istDate();

  const [preset, setPreset] = useState<DatePreset>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [method, setMethod] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [cashierId, setCashierId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [selectedTx, setSelectedTx] = useState<SalesRecordItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handlePreset = (p: DatePreset) => {
    setPreset(p);
    setPage(1);
    if (p === 'today') {
      setFrom(today);
      setTo(today);
    } else if (p === 'yesterday') {
      const y = addDays(today, -1);
      setFrom(y);
      setTo(y);
    } else if (p === 'last7') {
      setFrom(addDays(today, -6));
      setTo(today);
    } else if (p === 'last30') {
      setFrom(addDays(today, -29));
      setTo(today);
    } else if (p === 'thisMonth') {
      setFrom(today.slice(0, 8) + '01');
      setTo(today);
    }
  };

  const analytics = useShopAnalytics({
    from,
    to,
    cashierId: cashierId || undefined,
    method: method || undefined,
  });

  const handleExport = () => {
    const p = new URLSearchParams({ from, to });
    if (method) p.set('method', method);
    if (cashierId) p.set('cashierId', cashierId);
    const downloadUrl = `/api/shop/analytics/export?${p.toString()}${shopScope.q('&')}`;
    window.open(downloadUrl, '_blank');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (analytics.isPending) return <Spinner label={t('common.loading')} />;
  if (analytics.error) return <ErrorText error={analytics.error} />;

  const data = analytics.data;
  const kpis = data.kpis;
  const breakdown = data.paymentBreakdown;
  const totalTxCount = breakdown.qr.count + breakdown.cash.count + breakdown.card.count;
  const totalCollectionsPaise = breakdown.totalCollectionsPaise;
  const refundAmountPaise = kpis.refundAmountPaise;
  const netCollectionsPaise = totalCollectionsPaise - refundAmountPaise;

  const allRecords = data.salesRecords ?? [];

  const filteredRecords = allRecords.filter((tx) => {
    if (status && tx.paymentStatus !== status) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const code = tx.orderCode.toLowerCase();
      const txId = (tx.transactionId || tx.id).toLowerCase();
      const phone = tx.customerPhone.toLowerCase();
      const cashier = tx.cashierName.toLowerCase();
      const ref = (tx.paymentReference || '').toLowerCase();
      const bill = (tx.billNo || '').toLowerCase();
      const summary = tx.itemsSummary.toLowerCase();
      if (
        !code.includes(q) &&
        !txId.includes(q) &&
        !phone.includes(q) &&
        !cashier.includes(q) &&
        !ref.includes(q) &&
        !bill.includes(q) &&
        !summary.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const paginatedRecords = filteredRecords.slice(startIdx, startIdx + pageSize);

  return (
    <div className="space-y-6">
      {/* 7 Summary Cards */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat
            label={t('payments.totalCollections')}
            value={formatPaise(totalCollectionsPaise)}
            sub="UPI + Cash + Card"
          />
          <Stat
            label={t('payments.upiCollections')}
            value={formatPaise(breakdown.qr.totalPaise)}
            sub={`${breakdown.qr.count} orders`}
          />
          <Stat
            label={t('payments.cashCollections')}
            value={formatPaise(breakdown.cash.totalPaise)}
            sub={`${breakdown.cash.count} orders`}
          />
          <Stat
            label={t('payments.cardCollections')}
            value={formatPaise(breakdown.card.totalPaise)}
            sub={`${breakdown.card.count} orders`}
          />
          <Stat
            label={t('payments.totalTransactions')}
            value={String(totalTxCount)}
            sub="Completed payments"
          />
          <Stat
            label={t('payments.refunds')}
            value={formatPaise(refundAmountPaise)}
            sub="Counter refunds"
          />
          <Stat
            label={t('payments.netCollections')}
            value={formatPaise(netCollectionsPaise)}
            sub={t('payments.netCollectionsHelp')}
          />
        </div>

        {/* Clear separation of merchant funds vs ₹30 fee notice */}
        <Notice tone="plum" className="text-xs">
          💰 {t('payments.merchantRevenueNotice')}
        </Notice>
      </section>

      {/* Filter Bar: Presets, Custom Range, Methods, Status, Cashier, Search & CSV Export */}
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-sand/60 p-1">
            {(
              [
                ['today', t('report.today')],
                ['yesterday', t('report.yesterday')],
                ['last7', t('report.last7Days')],
                ['last30', t('report.last30Days')],
                ['thisMonth', t('report.thisMonth')],
                ['custom', t('report.customRange')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => handlePreset(key)}
                className={cx(
                  'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                  preset === key
                    ? 'bg-plum text-white shadow-xs'
                    : 'text-muted hover:text-ink hover:bg-sand',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <Button variant="secondary" size="sm" onClick={handleExport}>
            📊 {t('report.exportExcel')}
          </Button>
        </div>

        {/* Custom Date Pickers */}
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Field label={t('report.startDate')} className="w-auto">
              <Input
                type="date"
                value={from}
                max={today}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="mt-0 min-h-10 text-sm"
              />
            </Field>
            <Field label={t('report.endDate')} className="w-auto">
              <Input
                type="date"
                value={to}
                max={today}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="mt-0 min-h-10 text-sm"
              />
            </Field>
          </div>
        )}

        {/* Search & Dropdown Filters */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('payments.searchPlaceholder')}>
            <Input
              type="search"
              placeholder={t('payments.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="mt-0 min-h-10 text-sm"
            />
          </Field>

          <Field label={t('payments.method')}>
            <Select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                setPage(1);
              }}
              className="mt-0 min-h-10 text-sm"
            >
              <option value="">{t('payments.allMethods')}</option>
              <option value="upi">📱 {t('counter.phonepeQr')}</option>
              <option value="cash">💵 {t('counter.cash')}</option>
              <option value="card">💳 {t('counter.card')}</option>
            </Select>
          </Field>

          <Field label={t('payments.status')}>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="mt-0 min-h-10 text-sm"
            >
              <option value="">{t('payments.allStatuses')}</option>
              <option value="paid">✓ Paid</option>
              <option value="pending">⏳ Pending</option>
              <option value="cancelled">✕ Cancelled</option>
              <option value="refunded">↩ Refunded</option>
              <option value="failed">⚠ Failed</option>
            </Select>
          </Field>

          <Field label={t('payments.cashier')}>
            <Select
              value={cashierId}
              onChange={(e) => {
                setCashierId(e.target.value);
                setPage(1);
              }}
              className="mt-0 min-h-10 text-sm"
            >
              <option value="">{t('payments.allCashiers')}</option>
              {data.cashierReports.map((c) => (
                <option key={c.cashierId} value={c.cashierId}>
                  {c.cashierName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {/* Transaction History Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
              <tr>
                <th className="px-4 py-3">{t('payments.transactionId')}</th>
                <th className="px-4 py-3">{t('payments.orderCode')}</th>
                <th className="px-4 py-3">{t('payments.customer')}</th>
                <th className="px-4 py-3">{t('payments.products')}</th>
                <th className="px-3 py-3 text-center">{t('payments.method')}</th>
                <th className="px-4 py-3 text-right">{t('payments.amount')}</th>
                <th className="px-4 py-3">{t('payments.reference')}</th>
                <th className="px-4 py-3">{t('payments.cashier')}</th>
                <th className="px-4 py-3">{t('payments.dateTime')}</th>
                <th className="px-3 py-3 text-center">{t('payments.status')}</th>
                <th className="px-4 py-3 text-right">{t('payments.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((tx) => {
                  const txId = tx.transactionId || tx.id;
                  return (
                    <tr
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      className="cursor-pointer hover:bg-sand/20 transition"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted">
                        <div className="flex items-center gap-1.5">
                          <span title={txId}>{txId.slice(0, 8)}…</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(txId);
                            }}
                            className="text-gold-deep hover:underline text-[11px]"
                            title={t('payments.copyId')}
                          >
                            {copiedId === txId ? '✓' : '⧉'}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-ink">
                        <div>{formatOrderCode(tx.orderCode)}</div>
                        {tx.packNo != null && (
                          <div className="text-[11px] font-normal text-muted">
                            Pack #{tx.packNo}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">{staffPhoneMask(tx.customerPhone)}</td>
                      <td
                        className="px-4 py-3 text-xs text-muted max-w-xs truncate"
                        title={tx.itemsSummary}
                      >
                        {tx.itemsSummary || '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Badge
                          tone={
                            tx.paymentMethod === 'upi'
                              ? 'gold'
                              : tx.paymentMethod === 'cash'
                                ? 'emerald'
                                : 'plum'
                          }
                          className="text-xs"
                        >
                          {tx.paymentMethod === 'upi'
                            ? 'PhonePe QR'
                            : tx.paymentMethod === 'cash'
                              ? 'Cash'
                              : 'Card'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-ink whitespace-nowrap">
                        {formatPaise(tx.finalTotalPaise)}
                      </td>
                      <td
                        className="px-4 py-3 font-mono text-xs text-muted max-w-[120px] truncate"
                        title={tx.paymentReference || ''}
                      >
                        {tx.paymentReference || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                        {tx.cashierName}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                        {dateTimeIST(tx.completedAt)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Badge
                          tone={
                            tx.paymentStatus === 'paid'
                              ? 'emerald'
                              : tx.paymentStatus === 'pending'
                                ? 'gold'
                                : tx.paymentStatus === 'cancelled'
                                  ? 'rose'
                                  : 'plum'
                          }
                          className="text-xs capitalize"
                        >
                          {tx.paymentStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="secondary" onClick={() => setSelectedTx(tx)}>
                          {t('payments.viewDetails')}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-muted text-sm">
                    {t('payments.noTransactions')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredRecords.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sand/20 px-6 py-3 text-xs text-muted">
            <span>
              {t('payments.showingTransactions', {
                start: startIdx + 1,
                end: Math.min(startIdx + pageSize, filteredRecords.length),
                total: filteredRecords.length,
              })}
            </span>
            <div className="flex items-center gap-2">
              <span>{t('payments.page', { current: currentPage, total: totalPages })}</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ←
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  →
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 z-50 flex items-center justify-center bg-night/80 p-4"
          onClick={() => setSelectedTx(null)}
        >
          <Card
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-line pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-ink">{t('payments.transactionDetails')}</h3>
                  <Badge
                    tone={
                      selectedTx.paymentStatus === 'paid'
                        ? 'emerald'
                        : selectedTx.paymentStatus === 'pending'
                          ? 'gold'
                          : selectedTx.paymentStatus === 'cancelled'
                            ? 'rose'
                            : 'plum'
                    }
                  >
                    {selectedTx.paymentStatus.toUpperCase()}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">
                    ID: {selectedTx.transactionId || selectedTx.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(selectedTx.transactionId || selectedTx.id)}
                    className="text-xs font-semibold text-gold-deep hover:underline"
                  >
                    {copiedId === (selectedTx.transactionId || selectedTx.id)
                      ? `✓ ${t('payments.copied')}`
                      : t('payments.copyId')}
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="rounded-xl p-1.5 text-muted hover:bg-sand/60 hover:text-ink text-lg"
                onClick={() => setSelectedTx(null)}
                aria-label={t('common.cancel')}
              >
                ✕
              </button>
            </div>

            {/* Key Information Grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 rounded-2xl bg-sand/30 p-4 text-xs">
              <div>
                <p className="text-muted">{t('payments.orderCode')}</p>
                <p className="font-mono font-bold text-ink text-sm">
                  {selectedTx.orderCode} {selectedTx.packNo != null && `(#${selectedTx.packNo})`}
                </p>
              </div>
              <div>
                <p className="text-muted">{t('payments.dateTime')}</p>
                <p className="font-medium text-ink">{dateTimeIST(selectedTx.completedAt)}</p>
              </div>
              <div>
                <p className="text-muted">{t('payments.customer')}</p>
                <p className="font-medium text-ink">{staffPhoneMask(selectedTx.customerPhone)}</p>
              </div>
              <div>
                <p className="text-muted">{t('payments.cashier')}</p>
                <p className="font-medium text-ink">{selectedTx.cashierName}</p>
              </div>
              <div>
                <p className="text-muted">{t('payments.method')}</p>
                <p className="font-semibold text-ink">
                  {selectedTx.paymentMethod === 'upi'
                    ? '📱 PhonePe QR'
                    : selectedTx.paymentMethod === 'cash'
                      ? '💵 Cash'
                      : '💳 Card'}
                </p>
              </div>
              <div>
                <p className="text-muted">{t('payments.reference')}</p>
                <p className="font-mono text-ink">{selectedTx.paymentReference || '—'}</p>
              </div>
              <div>
                <p className="text-muted">{t('payments.verificationSource')}</p>
                <p className="font-medium text-ink">{selectedTx.verificationSource || 'manual'}</p>
              </div>
              <div>
                <p className="text-muted">{t('payments.billNo')}</p>
                <p className="font-mono font-semibold text-ink">{selectedTx.billNo || '—'}</p>
              </div>
            </div>

            {/* Itemized Table Breakdown */}
            <div className="space-y-2">
              <h4 className="text-sm font-bold tracking-wider text-muted uppercase">
                {t('payments.itemsBreakdown')}
              </h4>
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                    <tr>
                      <th className="px-4 py-2.5">{t('counter.orderDetails')}</th>
                      <th className="px-3 py-2.5 text-right">{t('payments.rate')}</th>
                      <th className="px-3 py-2.5 text-center">{t('payments.qty')}</th>
                      <th className="px-4 py-2.5 text-right">{t('payments.lineTotal')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {selectedTx.items && selectedTx.items.length > 0 ? (
                      selectedTx.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-sand/20">
                          <td className="px-4 py-2.5 font-medium text-ink">
                            <div>
                              {itemName({ nameEn: item.nameEn, nameTe: item.nameTe ?? null })}
                            </div>
                            {item.packDesc && (
                              <div className="text-xs text-muted">{item.packDesc}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-muted">
                            {formatPaise(item.unitPricePaise)}
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold">{item.qty}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-ink">
                            {formatPaise(item.totalPaise)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-muted">
                          {selectedTx.itemsSummary || '—'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Total Paid Highlight */}
            <div className="flex items-baseline justify-between rounded-2xl bg-sand/30 p-4 border border-line/60">
              <span className="text-base font-bold text-ink">{t('payments.totalPaid')}</span>
              <span className="font-display text-2xl font-bold text-gold-deep">
                {formatPaise(selectedTx.finalTotalPaise)}
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => window.print()}>
                🖨 {t('payments.printReceipt')}
              </Button>
              <Button onClick={() => setSelectedTx(null)}>
                {t('common.done', { defaultValue: 'Close' })}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export function Payments() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = (searchParams.get('tab') as 'history' | 'settings') || 'history';

  const setTab = (tab: 'history' | 'settings') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTitle
          title={
            currentTab === 'history' ? t('payments.historyTitle') : t('payments.settingsTitle')
          }
          subtitle={
            currentTab === 'history'
              ? t('payments.historySubtitle')
              : t('payments.settingsSubtitle')
          }
        />
        <div className="flex rounded-2xl bg-sand/60 p-1">
          <button
            type="button"
            onClick={() => setTab('history')}
            className={cx(
              'rounded-xl px-4 py-2 text-sm font-semibold transition',
              currentTab === 'history'
                ? 'bg-plum text-white shadow-xs'
                : 'text-muted hover:text-ink hover:bg-sand',
            )}
          >
            📊 {t('payments.tabHistory')}
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={cx(
              'rounded-xl px-4 py-2 text-sm font-semibold transition',
              currentTab === 'settings'
                ? 'bg-plum text-white shadow-xs'
                : 'text-muted hover:text-ink hover:bg-sand',
            )}
          >
            ⚙️ {t('payments.tabSettings')}
          </button>
        </div>
      </div>

      {currentTab === 'history' ? (
        <PaymentHistory />
      ) : (
        <Card className="max-w-3xl p-6">
          <PaymentSettingsForm />
        </Card>
      )}
    </div>
  );
}
