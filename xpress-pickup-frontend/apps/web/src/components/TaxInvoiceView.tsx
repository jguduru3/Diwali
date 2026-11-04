import { useTranslation } from 'react-i18next';
import { formatPaise, type TaxInvoice } from '@pataka/shared';
import { dayIST } from '../lib/format';
import { Button, Card, Notice } from './ui';

/**
 * A GST tax invoice (platform fee or merchant subscription), printable. Supplier, recipient,
 * SAC, taxable value, CGST and SGST and the GST-inclusive total, as GST rule 46 asks.
 */
export function TaxInvoiceView({ invoice }: { invoice: TaxInvoice }) {
  const { t } = useTranslation();
  const half = invoice.ratePercent / 2;
  const party = (p: TaxInvoice['recipient'], showGstinGap = false) => (
    <div className="space-y-0.5 text-sm">
      {p.name && <p className="font-semibold text-ink">{p.name}</p>}
      {p.address && <p className="text-muted">{p.address}</p>}
      {p.phone && <p className="text-muted">{p.phone}</p>}
      {(p.gstin || showGstinGap) && (
        <p className="text-muted">
          {t('invoice.gstin')}: {p.gstin ?? t('invoice.gstinNotSet')}
        </p>
      )}
    </div>
  );
  return (
    <Card className="print-area print-invoice mx-auto max-w-2xl space-y-5 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{t('invoice.title')}</h1>
          <p className="mt-1 font-mono text-sm text-muted">
            {t('invoice.number')} {invoice.invoiceNo}
          </p>
        </div>
        <div className="text-right text-sm text-muted">
          <p>
            {t('invoice.date')}: {dayIST(invoice.issuedAt)}
          </p>
          <p>
            {t('invoice.reference')}: <span className="font-mono">{invoice.reference}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-bold tracking-wide text-gold-deep uppercase">
            {t('invoice.supplier')}
          </p>
          {party(invoice.supplier, true)}
        </div>
        <div>
          <p className="mb-1 text-xs font-bold tracking-wide text-gold-deep uppercase">
            {t('invoice.recipient')}
          </p>
          {party(invoice.recipient)}
          <p className="mt-1 text-sm text-muted">
            {t('invoice.placeOfSupply')}: {invoice.placeOfSupply}
          </p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 font-semibold">{t('invoice.description')}</th>
            <th className="py-2 font-semibold">{t('invoice.sac')}</th>
            <th className="py-2 text-right font-semibold">{t('invoice.qty')}</th>
            <th className="py-2 text-right font-semibold">{t('invoice.taxable')}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.description} className="border-b border-line/70">
              <td className="py-2 pr-2">{l.description}</td>
              <td className="py-2 font-mono">{l.sac}</td>
              <td className="py-2 text-right">{l.qty}</td>
              <td className="py-2 text-right tabular-nums">{formatPaise(l.taxablePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        {[
          [t('invoice.taxable'), invoice.taxablePaise],
          [t('invoice.cgst', { rate: half }), invoice.cgstPaise],
          [t('invoice.sgst', { rate: half }), invoice.sgstPaise],
        ].map(([label, paise]) => (
          <div key={label as string} className="flex justify-between gap-6">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">{formatPaise(paise as number)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-6 border-t border-line pt-1 text-base font-bold">
          <dt>{t('invoice.total')}</dt>
          <dd className="tabular-nums">{formatPaise(invoice.totalPaise)}</dd>
        </div>
      </dl>

      {invoice.refunded && <Notice tone="plum">{t('invoice.refunded')}</Notice>}
      <p className="text-xs text-subtle">{t('invoice.footer')}</p>
      <div className="no-print">
        <Button type="button" variant="secondary" onClick={() => window.print()}>
          {t('invoice.print')}
        </Button>
      </div>
    </Card>
  );
}
