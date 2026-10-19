import { useTranslation } from 'react-i18next';
import type { Language, PushApp } from '@pataka/shared';
import { useDisablePush, useEnablePush, usePushState, useTestPush } from '../lib/webPush';
import { ErrorText } from './ErrorText';
import { Badge, Button, Card } from './ui';

/** Turn order notifications on or off for this phone and app. */
export function NotificationsCard({ app, className }: { app: PushApp; className?: string }) {
  const { t, i18n } = useTranslation();
  const { data, isPending } = usePushState(app);
  const enable = useEnablePush(app);
  const disable = useDisablePush();
  const test = useTestPush(app);
  if (isPending || !data) return null;
  const { state, publicKey } = data;

  const note =
    state === 'unsupported'
      ? t('notify.unsupported')
      : state === 'ios-install'
        ? t('notify.iosInstall')
        : state === 'blocked'
          ? t('notify.blocked')
          : state === 'not-configured'
            ? t('notify.notConfigured')
            : null;

  return (
    <Card className={className ?? 'p-6'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('notify.title')}</h2>
        {state === 'on' && <Badge tone="emerald">{t('notify.on')}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {app === 'merchant' ? t('notify.merchantBody') : t('notify.customerBody')}
      </p>
      {note && <p className="mt-3 text-sm font-medium">{note}</p>}
      <ErrorText error={enable.error ?? disable.error ?? test.error} />
      <div className="mt-4 flex flex-wrap gap-3">
        {state === 'off' && publicKey && (
          <Button
            disabled={enable.isPending}
            onClick={() => enable.mutate({ publicKey, lang: i18n.language as Language })}
          >
            {t('notify.enable')}
          </Button>
        )}
        {state === 'on' && (
          <>
            <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
              {t('notify.test')}
            </Button>
            <Button variant="ghost" disabled={disable.isPending} onClick={() => disable.mutate()}>
              {t('notify.disable')}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
