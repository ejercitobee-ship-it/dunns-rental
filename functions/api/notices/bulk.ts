import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, pre5DayNoticeEmail } from '../../lib/email';
import { getManagementUserIds, notifyMultiple } from '../../lib/notify';

interface BulkNoticeItem {
  propertyId?: string;
  unitId?: string;
  leaseId?: string;
  tenantId?: string;
  tenantEmail?: string;
  type: string;
  title: string;
  body: string;
  noticeDate: string;
  deliveryMethod?: string;
  status?: string;
  monthsBehind?: number;
  totalOwed?: string;
  tenantName?: string;
  propertyAddress?: string;
  unitNumber?: string;
}

/**
 * POST /api/notices/bulk — create multiple notices at once and optionally
 * email each tenant. Used by the "Pre 5 Day Notices" bulk action on the
 * Rent Management page.
 *
 * Body: { notices: BulkNoticeItem[], sendEmail?: boolean }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { notices: BulkNoticeItem[]; sendEmail?: boolean };
    const items = body.notices;
    if (!Array.isArray(items) || items.length === 0) {
      return jsonError('At least one notice is required', 400);
    }
    if (items.length > 100) {
      return jsonError('Maximum 100 notices per batch', 400);
    }

    const shouldEmail = !!body.sendEmail;
    const created: string[] = [];
    const emailed: string[] = [];

    // Load settings once for email context
    let companyName = 'MH Dunn Property';
    let companyPhone = '';
    try {
      const settings = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
        .bind('company').first<{ value: string }>();
      if (settings?.value) {
        const co = JSON.parse(settings.value);
        companyName = co.companyName || companyName;
        companyPhone = co.phone || '';
      }
    } catch { /* use defaults */ }

    const stmts = items.map(item => {
      const id = crypto.randomUUID();
      created.push(id);
      return env.DB.prepare(
        `INSERT INTO notices (id, property_id, unit_id, lease_id, tenant_id, type, title, body, notice_date, delivery_method, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        item.propertyId ?? null,
        item.unitId ?? null,
        item.leaseId ?? null,
        item.tenantId ?? null,
        item.type,
        item.title,
        item.body,
        item.noticeDate,
        item.deliveryMethod ?? (shouldEmail ? 'email' : null),
        shouldEmail ? 'sent' : (item.status ?? 'draft'),
        auth.id,
      );
    });

    // D1 batch limit is 100 statements
    await env.DB.batch(stmts);

    // Email each tenant (best effort, in background)
    if (shouldEmail) {
      context.waitUntil(
        (async () => {
          for (const item of items) {
            if (!item.tenantEmail) continue;
            try {
              if (item.type === 'pre_5_day' && item.monthsBehind && item.totalOwed) {
                const emailContent = pre5DayNoticeEmail({
                  tenantName: item.tenantName || 'Tenant',
                  propertyAddress: item.propertyAddress || '',
                  unitNumber: item.unitNumber,
                  monthsBehind: item.monthsBehind,
                  totalOwed: item.totalOwed,
                  companyName,
                  companyPhone,
                });
                await sendEmail(env, { to: item.tenantEmail, ...emailContent });
                emailed.push(item.tenantEmail);
              }
            } catch (e) {
              console.error(`bulk notice email failed for ${item.tenantEmail}:`, e);
            }
          }
        })().catch(e => console.error('bulk notice email batch failed', e))
      );
    }

    // Notify management
    context.waitUntil(
      getManagementUserIds(env, auth.id).then(userIds =>
        notifyMultiple(env, userIds.map(uid => ({
          userId: uid,
          type: 'tenant',
          category: 'notice_created',
          title: `${created.length} Pre 5 Day notice${created.length > 1 ? 's' : ''} created`,
          message: shouldEmail ? 'Tenants were emailed.' : 'Created as drafts.',
          entityType: 'notice',
          entityId: created[0],
          route: '/rents',
        })))
      ).catch(() => {})
    );

    return jsonOk({
      success: true,
      data: { created: created.length, emailed: shouldEmail },
    }, 201);
  } catch {
    return serverError();
  }
};
