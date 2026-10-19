import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { homePathForRole } from '@pataka/shared';
import { useMe } from '../auth/useAuth';
import { ButtonLink, Card, Spinner } from '../components/ui';
import { useDemoInfo } from '../lib/queries';
import { DemoAccountList } from '../components/DemoSwitcher';

/**
 * Start page of the installed merchant app: staff go straight to their screen
 * (shop, gate or console); anyone else is asked to sign in with a shop's number.
 */
export function MerchantStart() {
  const { t } = useTranslation();
  const { data: me, isPending } = useMe();
  const { data: demo } = useDemoInfo();
  if (isPending) return <Spinner label={t('common.loading')} />;
  if (me && me.role !== 'customer') return <Navigate to={homePathForRole(me.role)} replace />;

  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <img
        src="/icons/merchant-192.png"
        alt=""
        width={72}
        height={72}
        className="mx-auto h-18 w-18 rounded-2xl"
      />
      <h1 className="mt-4 text-2xl font-semibold">{t('merchantStart.title')}</h1>
      <p className="mt-2 text-muted">{t('merchantStart.body')}</p>
      {demo?.enabled ? (
        <div className="mt-6 text-left">
          <DemoAccountList accounts={demo.accounts} area="shop" />
        </div>
      ) : (
        <ButtonLink to="/login?next=%2Fmerchant" className="mt-6">
          {t('nav.signIn')}
        </ButtonLink>
      )}
    </Card>
  );
}
