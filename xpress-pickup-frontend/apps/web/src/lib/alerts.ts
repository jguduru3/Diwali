import { useMe } from '../auth/useAuth';
import { useMyOrders } from './queries';

/** The customer's orders where a shop changed something and waits for an answer. */
export function useOrdersNeedingAnswer() {
  const { data: me } = useMe();
  const orders = useMyOrders(me?.role === 'customer');
  return (orders.data ?? []).filter((o) => o.status === 'awaiting_customer');
}
