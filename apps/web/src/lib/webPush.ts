// Browser side of web push: permission, subscription and telling the API.
// iOS only offers push to a Home Screen app (16.4+), so the UI checks that first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pushKeyResponseSchema, type Language, type PushApp } from '@pataka/shared';
import { api } from './api';
import { isIos, isStandalone } from './appKind';

export type PushState =
  | 'unsupported'
  | 'ios-install' // iPhone in Safari: add to Home Screen first
  | 'not-configured' // server has no VAPID key
  | 'blocked'
  | 'off'
  | 'on';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.ready;
}

const STATE_KEY = ['push-state'] as const;

/** Where push stands on this phone for the given app. */
export function usePushState(app: PushApp) {
  return useQuery({
    queryKey: [...STATE_KEY, app],
    queryFn: async (): Promise<{ state: PushState; publicKey: string | null }> => {
      if (isIos() && !isStandalone()) return { state: 'ios-install', publicKey: null };
      if (!pushSupported()) return { state: 'unsupported', publicKey: null };
      const { publicKey } = await api('/push/key', { schema: pushKeyResponseSchema });
      if (!publicKey) return { state: 'not-configured', publicKey };
      if (Notification.permission === 'denied') return { state: 'blocked', publicKey };
      const sub = await (await registration()).pushManager.getSubscription();
      return { state: sub && Notification.permission === 'granted' ? 'on' : 'off', publicKey };
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useEnablePush(app: PushApp) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ publicKey, lang }: { publicKey: string; lang: Language }) => {
      // Must run straight from the tap: iOS refuses permission prompts otherwise.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api('/push/subscribe', {
        method: 'POST',
        body: { endpoint: json.endpoint, keys: json.keys, app, lang },
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: STATE_KEY }),
  });
}

export function useDisablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const sub = await (await registration()).pushManager.getSubscription();
      if (!sub) return;
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: STATE_KEY }),
  });
}

export function useTestPush(app: PushApp) {
  return useMutation({
    mutationFn: () => api('/push/test', { method: 'POST', body: { app } }),
  });
}
