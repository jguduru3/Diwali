import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { TaxInvoiceView } from '../../components/TaxInvoiceView';
import { Card, EmptyState, Spinner } from '../../components/ui';
import { useShopInvoices } from '../../lib/queries';

/** The shop's GST tax invoices for its season subscription (owner). */
export function Invoices() {
  const { t } = useTranslation();
  const invoices = useShopInvoices();
  if (invoices.isPending) return <Spinner label={t('common.loading')} />;
  if (!invoices.data) return <ErrorText error={invoices.error} />;
  return (
    <div className="space-y-6">
      <Card className="no-print max-w-2xl p-6">
        <h2 className="text-xl font-bold">{t('invoice.shopTitle')}</h2>
        <p className="mt-1 text-muted">{t('invoice.shopBody')}</p>
      </Card>
      {invoices.data.length === 0 ? (
        <EmptyState title={t('invoice.none')} />
      ) : (
        invoices.data.map((inv) => <TaxInvoiceView key={inv.invoiceNo} invoice={inv} />)
      )}
    </div>
  );
}
