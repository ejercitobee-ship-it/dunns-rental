import { portalApi } from './api';

// Matches the VAPID public key the server signs with. Public and safe to embed.
const VAPID_PUBLIC = 'BJn2xnYBnkFQXw5pQHW41LQI-CK7vNMCt25fgeeKbVMidsQUA1O4l1UCrbSne4zHWilE26pO2RzNNNiOdCiCGRQ';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Whether push is unsupported, blocked, on, or off for this device right now. */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Ask permission, subscribe this device, and register it with the server. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked. Turn them on for this site in your browser settings.'
        : 'Notifications were not turned on.'
    );
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    });
  }
  await portalApi.pushSubscribe(sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } });
}

/** Turn off notifications on this device. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await portalApi.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}
