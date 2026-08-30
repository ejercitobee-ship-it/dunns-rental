import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, jsonError, serverError } from '../../lib/session';
import { ensureRootFolder, findFolder, createFolder, uploadToDrive } from '../../lib/google';

/**
 * POST /api/cron/backup — monthly database backup to Google Drive.
 *
 * Exports every data table to a single JSON file, uploads it to a "Backups"
 * folder inside the app's root Google Drive folder. The file is named with
 * the current date so each month's snapshot is preserved.
 *
 * Protected by CRON_SECRET (same as the other cron endpoints). The external
 * scheduled Worker calls this on the 1st of every month.
 */

const BACKUP_FOLDER_NAME = 'Backups';

/** All application tables to include in the backup, ordered logically. */
const TABLES = [
  // Core
  'properties',
  'units',
  'tenants',
  'leases',
  'lease_tenants',
  'lease_pauses',
  'household_members',
  // Financials
  'rent_payments',
  'tenant_credits',
  'expenses',
  'expense_imports',
  'expense_import_rows',
  'incomes',
  // Maintenance
  'maintenance_requests',
  'maintenance_status_log',
  'handymen',
  'handyman_messages',
  // Documents
  'documents',
  'document_templates',
  // Users and access
  'user',
  'user_roles',
  'user_metadata',
  'user_permission_overrides',
  'permission_audit_log',
  'account',
  'tenant_emails',
  'tenant_realtors',
  // Activity and audit
  'activity_log',
  'lease_audit_log',
  'lease_notifications',
  // Messages
  'messages',
  // Calendar
  'calendar_events',
  'calendar_event_properties',
  // Settings
  'app_settings',
  // Inspections, notices, deposits
  'inspections',
  'inspection_items',
  'notices',
  'deposit_returns',
  'deposit_deductions',
  // Prospective tenants
  'prospective_tenants',
  // Property notes
  'property_notes',
  'property_note_attachments',
  // Utility accounts
  'utility_accounts',
  // Appliances
  'appliances',
  // Capital projects
  'capital_projects',
  // Vendor submissions
  'vendor_submissions',
  // Announcements
  'announcements',
  // Notifications and push
  'notifications',
  'push_subscriptions',
  // AI conversations
  'ai_conversations',
  'ai_messages',
  // Roles
  'roles',
] as const;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate via CRON_SECRET.
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) return jsonError('CRON_SECRET not configured', 500);
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${cronSecret}`) return jsonError('Unauthorized', 401);

  try {
    const backup: Record<string, unknown[]> = {};
    let totalRows = 0;

    for (const table of TABLES) {
      try {
        const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
        backup[table] = result.results || [];
        totalRows += backup[table].length;
      } catch {
        // Table may not exist yet (migration not applied). Skip it.
        backup[table] = [];
      }
    }

    // Build the JSON payload.
    const now = new Date();
    const dateLabel = now.toISOString().slice(0, 10); // 2026-08-01
    const payload = JSON.stringify({
      exportedAt: now.toISOString(),
      tableCount: Object.keys(backup).filter(k => (backup[k] as unknown[]).length > 0).length,
      totalRows,
      tables: backup,
    }, null, 2);

    // Upload to Google Drive under RootFolder > Backups.
    const root = await ensureRootFolder(env);
    const backupFolderId =
      (await findFolder(env, BACKUP_FOLDER_NAME, root)) ??
      (await createFolder(env, BACKUP_FOLDER_NAME, root));

    const fileName = `MH Dunn Backup ${dateLabel}.json`;
    const blob = new Blob([payload], { type: 'application/json' });
    const { id: driveFileId } = await uploadToDrive(env, backupFolderId, fileName, 'application/json', blob);

    const sizeMB = (payload.length / (1024 * 1024)).toFixed(2);

    return jsonOk({
      success: true,
      message: `Backup complete: ${totalRows} rows across ${Object.keys(backup).filter(k => (backup[k] as unknown[]).length > 0).length} tables (${sizeMB} MB)`,
      fileName,
      driveFileId,
      date: dateLabel,
    });
  } catch (err) {
    console.error('Backup error:', err);
    return serverError();
  }
};
