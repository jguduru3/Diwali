import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NotificationsCard } from '../../components/NotificationsCard';
import { Spinner } from '../../components/ui';
import { useShopContext } from '../../lib/queries';
import { Orders } from './Orders';

/** Packers land on packing and cashiers on the counter; owners and staff on orders. */
export function ShopHome() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  if (!ctx.data) return <Spinner label={t('common.loading')} />;
  if (ctx.data.role === 'shop_packer') return <Navigate to="/shop/packing" replace />;
  if (ctx.data.role === 'shop_cashier') return <Navigate to="/shop/counter" replace />;
  return (
    <>
      <Orders />
      <NotificationsCard app="merchant" className="mt-8 p-6" />
    </>
  );
}
