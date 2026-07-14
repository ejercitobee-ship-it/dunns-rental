import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

// Default settings returned when nothing has been saved yet. Keys mirror the
// shapes the Settings page expects.
const DEFAULTS = {
  company: {
    companyName: "DUNN's Rental",
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    taxId: '',
  },
  rent: {
    lateFeeAmount: 75,
    lateFeeDay: 5,
    gracePeriod: 3,
    defaultLeaseTerm: 12,
    securityDepositMultiplier: 2,
  },
  notifications: {
    emailNotifications: true,
    smsNotifications: false,
    rentReminders: true,
    leaseExpiryAlerts: true,
    maintenanceAlerts: true,
    paymentConfirmations: true,
  },
};

type SettingsKey = keyof typeof DEFAULTS;
const KEYS = Object.keys(DEFAULTS) as SettingsKey[];

async function loadAll(env: Env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM app_settings').all<{
    key: string;
    value: string;
  }>();

  const stored = new Map((results || []).map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const raw = stored.get(key);
    let parsed: Record<string, unknown> = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    // Merge saved values over defaults so new fields always have a value.
    out[key] = { ...DEFAULTS[key], ...parsed };
  }
  return out;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_view');
  if (auth instanceof Response) return auth;

  try {
    return jsonOk({ success: true, data: await loadAll(env) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);

    for (const key of KEYS) {
      if (body[key] === undefined) continue;
      // Store defaults merged with the incoming values so a partial payload
      // never drops fields.
      const merged = { ...DEFAULTS[key], ...(body[key] as Record<string, unknown>) };
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
        .bind(key, JSON.stringify(merged), now)
        .run();
    }

    return jsonOk({ success: true, data: await loadAll(env) });
  } catch {
    return serverError();
  }
};
