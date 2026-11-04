import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { settings } from '../lib/settings';

/** The old in-app /play page: saved links and installed shortcuts go on to the BEA game. */
export function GameRedirect() {
  useEffect(() => {
    window.location.replace(settings.gameUrl);
  }, []);
  return null;
}

/**
 * Small floating BEA icon: tap to open the BEA game while the order is being packed. It sits
 * at the left edge, where cards have text and photos; their buttons and steppers are on the right.
 * The game opens in a new tab so the order page stays where it was.
 */
export function BeaFloat() {
  const { t } = useTranslation();
  return (
    <a
      href={settings.gameUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('game.open')}
      title={t('game.open')}
      className="no-print fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] left-2 z-30 block h-12 w-12 rounded-full transition hover:scale-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold sm:bottom-28 sm:left-5"
    >
      <img
        src="/bea.png"
        alt=""
        width={48}
        height={48}
        className="h-full w-full object-contain drop-shadow-[0_4px_6px_rgba(20,10,60,0.35)]"
      />
    </a>
  );
}
