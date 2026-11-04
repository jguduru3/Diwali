// App-level PWA pieces: "new version" prompt, offline banner, and the install
// prompt (Android's beforeinstallprompt; on iPhone, how to Add to Home Screen).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { PushApp } from '@pataka/shared';
import { isIos, isStandalone } from '../lib/appKind';
import { Button } from './ui';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'dx.installDismissedAt';
const DISMISS_DAYS = 7;

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

const bar =
  'pointer-events-auto flex w-full flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-[0_18px_40px_-18px_rgb(0_0_0/0.6)]';

function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Installed apps can stay open all evening: look for a new version hourly.
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div role="status" className={`${bar} night-sky text-white`}>
      <p className="flex-1 font-semibold">{t('pwa.updateReady')}</p>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        {t('pwa.reload')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-white"
        onClick={() => setNeedRefresh(false)}
      >
        {t('pwa.later')}
      </Button>
    </div>
  );
}

export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="status"
      className="no-print bg-saffron/15 px-4 py-2 text-center text-sm font-semibold"
    >
      {t('pwa.offline')}
    </div>
  );
}

function InstallPrompt({ app }: { app: PushApp }) {
  const { t } = useTranslation();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());
  const ios = isIos();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // show our own bar instead of the mini-infobar
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || (!event && !ios)) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // storage unavailable
    }
    setHidden(true);
  };
  return (
    <div
      role="dialog"
      aria-label={t('pwa.installTitle')}
      className={`${bar} border border-line bg-white`}
    >
      <img
        src={`/icons/${app}-192.png`}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 rounded-xl"
      />
      <div className="min-w-0 flex-1 basis-[calc(100%-4rem)]">
        <p className="font-semibold">{t('pwa.installTitle')}</p>
        <p className="text-muted">
          {app === 'merchant' ? t('pwa.installMerchant') : t('pwa.installCustomer')}
          {ios && !event && <> {t('pwa.iosHint')}</>}
        </p>
      </div>
      <div className="ml-auto flex gap-2">
        {event && (
          <Button
            size="sm"
            onClick={async () => {
              await event.prompt();
              const { outcome } = await event.userChoice;
              setEvent(null);
              if (outcome === 'accepted') setHidden(true);
            }}
          >
            {t('pwa.install')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t('pwa.later')}
        </Button>
      </div>
    </div>
  );
}

export function PwaChrome({ app }: { app: PushApp }) {
  // One stack at the bottom so the bars never overlap each other.
  return (
    <div
      className="no-print pointer-events-none fixed inset-x-3 z-50 mx-auto flex max-w-xl flex-col gap-2"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <UpdatePrompt />
      <InstallPrompt app={app} />
    </div>
  );
}
