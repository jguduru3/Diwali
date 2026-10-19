import type { PushApp } from '@pataka/shared';

/** Same rule as public/app-shell.js, which applies it before the first render. */
export function appForPath(pathname: string): PushApp {
  if (/^\/(merchant|shop|gate|admin)(\/|$)/.test(pathname)) return 'merchant';
  try {
    if (isStandalone() && sessionStorage.getItem('dx.app') === 'merchant') return 'merchant';
  } catch {
    // storage unavailable
  }
  return 'customer';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad Safari (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

const set = (selector: string, attr: string, value: string) =>
  document.querySelector(selector)?.setAttribute(attr, value);

/** Keeps the manifest, iOS icon/title and theme colour matching the app on navigation. */
export function syncAppChrome(pathname: string) {
  const app = appForPath(pathname);
  const merchant = app === 'merchant';
  if (merchant) {
    try {
      sessionStorage.setItem('dx.app', 'merchant');
    } catch {
      // storage unavailable
    }
  }
  set('link[rel="manifest"]', 'href', merchant ? '/merchant.webmanifest' : '/manifest.webmanifest');
  set('link[rel="apple-touch-icon"]', 'href', `/icons/${app}-apple-180.png`);
  set(
    'meta[name="apple-mobile-web-app-title"]',
    'content',
    merchant ? 'DX Merchant' : 'Diwali Express',
  );
  set('meta[name="theme-color"]', 'content', merchant ? '#082623' : '#140c24');
  document.documentElement.dataset.app = app;
  return app;
}
