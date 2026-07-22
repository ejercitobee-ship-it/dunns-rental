import { type Env } from './session';

// The VAPID public key (application server key). Public and safe to embed; the
// browser client uses the same value to subscribe. The matching private key
// lives in the VAPID_PRIVATE_JWK secret and never leaves the server.
export const VAPID_PUBLIC =
  'BJn2xnYBnkFQXw5pQHW41LQI-CK7vNMCt25fgeeKbVMidsQUA1O4l1UCrbSne4zHWilE26pO2RzNNNiOdCiCGRQ';
const VAPID_SUBJECT = 'mailto:info@mhdunnproperty.net';

function b64urlBytes(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str: string): string {
  return b64urlBytes(new TextEncoder().encode(str));
}

/** A signed VAPID JWT for one push service origin (the endpoint's origin). */
async function vapidToken(env: Env, audience: string): Promise<string | null> {
  if (!env.VAPID_PRIVATE_JWK) return null;
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(atob(env.VAPID_PRIVATE_JWK));
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const header = b64urlStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64urlStr(
    JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: VAPID_SUBJECT })
  );
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;
}

interface Subscription {
  id: string;
  endpoint: string;
}

/** Send an empty "tickle" to one subscription; the device then fetches the
 * queued notifications. Returns the HTTP status (or 0 on network error). */
async function sendTickle(env: Env, sub: Subscription): Promise<number> {
  const aud = new URL(sub.endpoint).origin;
  const token = await vapidToken(env, aud);
  if (!token) return 0;
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${token}, k=${VAPID_PUBLIC}`,
        TTL: '86400',
        'Content-Length': '0',
      },
    });
    return res.status;
  } catch {
    return 0;
  }
}

export interface NotificationInput {
  title: string;
  body?: string;
  url?: string;
}

/**
 * Queue a notification for a user and wake every device they have subscribed.
 * Best-effort: callers run it in waitUntil. A device whose subscription is gone
 * (404 or 410) is pruned. Does nothing when push is not configured or the user
 * has no subscriptions.
 */
export async function sendPushToUser(env: Env, userId: string | null | undefined, notif: NotificationInput): Promise<void> {
  if (!userId || !env.VAPID_PRIVATE_JWK) return;

  const { results } = await env.DB.prepare('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<Subscription>();
  const subs = results || [];
  if (subs.length === 0) return;

  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, title, body, url) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(crypto.randomUUID(), userId, notif.title, notif.body ?? null, notif.url ?? null)
    .run();

  for (const sub of subs) {
    const status = await sendTickle(env, sub);
    if (status === 404 || status === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
    }
  }
}

/** Push to a tenant by their tenant record id (resolves their login). */
export async function sendPushToTenant(env: Env, tenantId: string | null | undefined, notif: NotificationInput): Promise<void> {
  if (!tenantId) return;
  const t = await env.DB.prepare('SELECT user_id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ user_id: string | null }>();
  await sendPushToUser(env, t?.user_id, notif);
}
