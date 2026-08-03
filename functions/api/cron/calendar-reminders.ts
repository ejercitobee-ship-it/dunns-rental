import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, calendarEventEmail } from '../../lib/email';

/**
 * POST /api/cron/calendar-reminders — check for calendar events with
 * reminder_hours set and send email reminders to admins when the event is
 * within the reminder window. Triggered daily by a scheduled worker
 * (CRON_SECRET) or by an admin manually.
 *
 * Only sends once per event: sets last_reminder_sent = event_date after
 * sending so it won't fire again for the same occurrence.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cronOk = !!env.CRON_SECRET && presented === env.CRON_SECRET;
  if (!cronOk) {
    const user = await getSessionUser(env, request);
    if (!user || !['super_admin', 'admin'].includes(user.role)) {
      return jsonError('Not authorized', 401);
    }
  }

  try {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const { results: events } = await env.DB.prepare(
      `SELECT ce.*, p.name AS property_name, p.address AS property_address,
              u.unit_number
       FROM calendar_events ce
       LEFT JOIN properties p ON ce.property_id = p.id
       LEFT JOIN units u ON ce.unit_id = u.id
       WHERE ce.completed = 0
         AND ce.reminder_hours IS NOT NULL
         AND (ce.last_reminder_sent IS NULL OR ce.last_reminder_sent != ce.event_date)
         AND ce.event_date >= ?
       ORDER BY ce.event_date ASC`
    ).bind(todayStr).all();

    const admins = await env.DB.prepare(
      `SELECT email FROM user WHERE role IN ('super_admin', 'admin') AND email IS NOT NULL`
    ).all();
    const adminEmails = (admins.results || []).map(r => r.email as string).filter(Boolean);

    if (adminEmails.length === 0) {
      return jsonOk({ success: true, sent: 0, reason: 'No admin email addresses configured' });
    }

    let sent = 0;
    const nowMs = now.getTime();

    for (const event of (events || [])) {
      const eventDate = event.event_date as string;
      const reminderHours = Number(event.reminder_hours);
      const eventMs = new Date(eventDate + 'T00:00:00').getTime();
      const reminderMs = reminderHours * 60 * 60 * 1000;

      if (nowMs >= eventMs - reminderMs && nowMs < eventMs + 86400000) {
        const propertyName = (event.property_name || event.property_address || '') as string;
        const unitLabel = event.unit_number ? `Unit ${event.unit_number}` : undefined;
        const reminderLabel = reminderHours >= 168 ? `${Math.round(reminderHours / 24)} days before` : `${reminderHours} hours before`;

        const email = calendarEventEmail({
          type: 'reminder',
          title: event.title as string,
          eventDate,
          propertyName: propertyName || undefined,
          unitLabel,
          description: (event.description as string) || undefined,
          category: (event.category as string) || undefined,
          priority: (event.priority as string) || undefined,
          reminderInfo: reminderLabel,
        });

        for (const to of adminEmails) {
          const ok = await sendEmail(env, { to, ...email });
          if (ok) sent++;
        }

        await env.DB.prepare(
          'UPDATE calendar_events SET last_reminder_sent = ? WHERE id = ?'
        ).bind(eventDate, event.id).run();
      }
    }

    return jsonOk({ success: true, sent, checked: (events || []).length });
  } catch (err) {
    console.error('calendar-reminders error:', err);
    return serverError();
  }
};
