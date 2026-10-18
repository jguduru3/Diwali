import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { canAccessArea, type Area } from '@pataka/shared';
import { DemoAccountList } from '../components/DemoSwitcher';
import { buttonClass, Card, Spinner } from '../components/ui';
import { useDemoInfo } from '../lib/queries';
import { useMe } from './useAuth';

/**
 * Client-side gate for an app area. It only hides screens; every API call is
 * checked again on the server (requireRole), which is the real boundary.
 * In demo mode, a signed-out visitor picks a demo account here instead of an OTP.
 * area undefined = any signed-in account.
 */
export function RequireRole({ area, children }: { area?: Area; children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { data: me, isPending, isError } = useMe();
  const { data: demo, isPending: demoPending } = useDemoInfo();

  if (isPending) return <Spinner label={t('common.loading')} />;
  if (isError) return <p role="alert">{t('errors.generic')}</p>;

  const allowed = me && (!area || canAccessArea(me.role, area));
  if (allowed) return <>{children}</>;

  if (demo?.enabled) {
    return (
      <Card className="mx-auto max-w-2xl p-6 sm:p-8">
        <p className="text-xs font-bold tracking-[0.18em] text-gold-deep uppercase">
          {t('demo.pill')}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {area ? t('demo.gateTitle', { area: t(`nav.${area}`) }) : t('demo.pick')}
        </h1>
        <p className="mt-2 mb-5 text-muted">{t('demo.gateBody')}</p>
        <DemoAccountList accounts={demo.accounts} area={area} />
      </Card>
    );
  }
  if (demoPending) return <Spinner label={t('common.loading')} />;

  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold">{t('forbidden.title')}</h1>
      <p className="mt-2 text-muted">
        {t('forbidden.body', { role: t(`roles.${me.role}`), area: t(`nav.${area}`) })}
      </p>
      <Link to="/" className={buttonClass('secondary', 'md', 'mt-6')}>
        {t('notFound.back')}
      </Link>
    </Card>
  );
}
