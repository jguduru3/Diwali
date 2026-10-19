/// <reference lib="webworker" />
// Service worker for both installable apps (customer + merchant): precached app
// shell, offline price lists and orders (SPEC §15), and web push (SPEC_V3 §11).
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { fillTemplate, pushPayloadSchema } from '@pataka/shared';
import { push as enPush } from './i18n/en.json';
import { push as tePush } from './i18n/te.json';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The app shell answers every page; API calls never fall back to it.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }),
);

// Price lists, shop context and the customer's own orders keep working with no signal.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    /^\/api\/(shops\/[^/]+\/items|shop\/items|shop\/context|orders\/[^/]+$)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'api-offline',
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 2 * 24 * 3600 })],
  }),
);

registerRoute(
  ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
  new CacheFirst({
    cacheName: 'osm-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

// The page asks before switching to a new version (see UpdatePrompt).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();

// ---- Push ----

const TEXT = { en: enPush, te: tePush } as const;

self.addEventListener('push', (event) => {
  let data: unknown;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  const parsed = pushPayloadSchema.safeParse(data);
  if (!parsed.success) return;
  const { kind, lang, url, tag, params } = parsed.data;
  const text = TEXT[lang][kind] ?? TEXT.en[kind];
  const merchant = url.startsWith('/shop') || url.startsWith('/merchant');
  event.waitUntil(
    self.registration.showNotification(fillTemplate(text.title, params), {
      body: fillTemplate(text.body, params),
      icon: merchant ? '/icons/merchant-192.png' : '/icons/customer-192.png',
      badge: '/icons/badge-96.png',
      tag,
      data: { url },
      lang,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string } | null)?.url ?? '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
