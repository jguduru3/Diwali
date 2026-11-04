import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { TaxInvoiceView } from '../../components/TaxInvoiceView';
import { ButtonLink, Spinner } from '../../components/ui';
import { useFeeInvoice } from '../../lib/queries';

/** The GST tax invoice for my order's platform fee. */
export function FeeInvoicePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const invoice = useFeeInvoice(id);
  return (
    <div className="space-y-4">
      <ButtonLink to={`/orders/${id}`} variant="ghost" size="sm" className="no-print">
        ← {t('invoice.back')}
      </ButtonLink>
      {invoice.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : invoice.data ? (
        <TaxInvoiceView invoice={invoice.data} />
      ) : (
        <ErrorText error={invoice.error} />
      )}
    </div>
  );
}
