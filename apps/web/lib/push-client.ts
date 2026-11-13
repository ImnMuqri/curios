import { apiFetch } from './api.js';

/**
 * Push notifications on this device (Settings, "Notify this device"): whether the browser can,
 * and turning them on and off. The service worker that shows them is public/sw.js.
 */

/** Why this device can or cannot have notifications, as Settings explains it. */
export type PushSupport =
  | 'ok'
  /** An iPhone or iPad in Safari's tab: Apple only allows push once Curios is on the Home Screen. */
  | 'ios-install'
  /** A browser with no push at all. */
  | 'unsupported';

export function isIos(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** Opened from the Home Screen (or installed on a computer), not in a browser tab. */
export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (isIos() && !isInstalled()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

/** The VAPID public key, base64url, as the PushManager wants it: bytes. */
function keyBytes(base64url: string): Uint8Array {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export interface PushClient {
  support: () => PushSupport;
  /** The server's key; null when push is switched off there. */
  publicKey: () => Promise<string | null>;
  permission: () => NotificationPermission;
  /** This browser's current subscription address, if it has one. */
  current: () => Promise<string | null>;
  /** Asks permission (must run from a tap), subscribes, and saves this device. */
  turnOn: (publicKey: string) => Promise<'on' | 'denied'>;
  turnOff: () => Promise<void>;
  test: () => Promise<void>;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

export const browserPushClient: PushClient = {
  support: pushSupport,
  publicKey: async () => (await apiFetch<{ publicKey: string | null }>('/push/key')).publicKey,
  permission: () => Notification.permission,
  current: async () => {
    const existing = await navigator.serviceWorker.getRegistration('/');
    const subscription = await existing?.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  },
  turnOn: async (publicKey) => {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const reg = await registration();
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
    const json = subscription.toJSON();
    await apiFetch('/push/devices', {
      method: 'PUT',
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) }),
    });
    return 'on';
  },
  turnOff: async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await apiFetch('/push/devices', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
  },
  test: async () => {
    const endpoint = await browserPushClient.current();
    if (!endpoint) throw new Error('Turn notifications on first.');
    await apiFetch('/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) });
  },
};
