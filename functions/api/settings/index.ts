import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { logActivityAsync } from '../../lib/activity';

// Default settings returned when nothing has been saved yet. Keys mirror the
// shapes the Settings page expects.
const DEFAULTS = {
  company: {
    companyName: 'MH Dunn Property',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: 'info@mhdunnproperty.net',
    taxId: '',
  },
  rent: {
    lateFeeAmount: 75,
    lateFeeDay: 5,
    gracePeriod: 3,
    defaultLeaseTerm: 12,
    securityDepositMultiplier: 2,
    // Flag a tenancy as past due once it owes this many months of rent. Used by
    // the dashboard, the tenant profile, and the tenant portal.
    pastDueMonths: 2,
    // The day of the month rent is due. Shown to tenants and used by the
    // monthly rent reminder.
    rentDueDay: 1,
    // Shown to tenants on their portal under "How to pay". The portal adds each
    // tenant's own memo (street, unit, month, name) beneath this.
    paymentInstructions: 'Pay your rent by Zelle to 7739917112.',
  },
  notifications: {
    emailNotifications: true,
    smsNotifications: false,
    rentReminders: true,
    leaseExpiryAlerts: true,
    maintenanceAlerts: true,
    paymentConfirmations: true,
  },
  finances: {
    /** Configurable capitalization threshold. Expenses above this amount are
     *  suggested as capital, but the user always makes the final call. */
    capitalThreshold: 2500,
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

    const changedKeys = KEYS.filter(k => body[k] !== undefined);
    context.waitUntil(
      logActivityAsync(env, auth, {
        module: 'settings',
        action: 'Updated settings',
        targetType: 'settings',
        description: `Updated: ${changedKeys.join(', ')}`,
      }).catch(() => {})
    );

    return jsonOk({ success: true, data: await loadAll(env) });
  } catch {
    return serverError();
  }
};
