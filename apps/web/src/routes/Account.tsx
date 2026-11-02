import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { maskPhone } from '@pataka/shared';
import { useDeleteAccount, useLogout, useMe } from '../auth/useAuth';
import { ErrorText } from '../components/ErrorText';
import { MembershipList } from '../components/MembershipList';
import { NotificationsCard } from '../components/NotificationsCard';
import { Badge, Button, Card, PageTitle } from '../components/ui';

export function Account() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const logout = useLogout();
  const del = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);
  if (!me) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle eyebrow={t('nav.account')} title={me.displayName ?? t('account.title')} />
      <Card className="p-6">
        <dl className="grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('account.phone')}
            </dt>
            <dd className="mt-1 font-mono text-lg">{maskPhone(me.phone)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('account.role')}
            </dt>
            <dd className="mt-1">
              <Badge tone="gold">{t(`roles.${me.role}`)}</Badge>
            </dd>
          </div>
          {me.memberships.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('account.memberships')}
              </dt>
              <dd className="mt-1 font-semibold">
                <MembershipList memberships={me.memberships} />
              </dd>
            </div>
          )}
        </dl>
        <Button
          variant="secondary"
          className="mt-6"
          onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/') })}
          disabled={logout.isPending}
        >
          {t('account.signOut')}
        </Button>
      </Card>

      <NotificationsCard
        app={me.role === 'customer' ? 'customer' : 'merchant'}
        className="mt-6 p-6"
      />

      <Card className="mt-6 border-danger/20 p-6">
        <h2 className="text-lg font-semibold">{t('account.deleteTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('account.deleteBody')}</p>
        <ErrorText error={del.error} />
        <div className="mt-4 flex flex-wrap gap-3">
          {confirming ? (
            <>
              <Button
                variant="danger"
                disabled={del.isPending}
                onClick={() => del.mutate(undefined, { onSuccess: () => navigate('/') })}
              >
                {t('account.deleteConfirm')}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {t('account.delete')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
