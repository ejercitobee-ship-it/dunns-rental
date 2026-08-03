import type { Env } from './session';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** The only scope this app ever asks for: files it created, nothing else. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const KEY_REFRESH = 'google_refresh_token';
const KEY_ACCESS = 'google_access_token';
const KEY_ACCESS_EXPIRES = 'google_access_expires_at';
const KEY_ROOT_FOLDER = 'google_root_folder_id';
const KEY_PHOTO_FOLDER = 'google_photo_folder_id';
const KEY_MAINTENANCE_FOLDER = 'google_maintenance_folder_id';
const KEY_PROSPECTIVE_FOLDER = 'google_prospective_folder_id';
const KEY_VENDORS_FOLDER = 'google_vendors_folder_id';

/** The single top-level folder that holds every tenant's folder. */
const ROOT_FOLDER_NAME = 'MH Dunn Property Documents';
const PHOTO_FOLDER_NAME = 'Profile Photos';
const MAINTENANCE_FOLDER_NAME = 'Maintenance Photos';
const PROSPECTIVE_FOLDER_NAME = 'Prospective Tenants';
const VENDORS_FOLDER_NAME = 'Vendors';

/** Thrown when Belle has not connected Drive. Endpoints turn this into a 503. */
export class DriveNotConnected extends Error {
  constructor() {
    super('Google Drive is not connected');
    this.name = 'DriveNotConnected';
  }
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function putSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`
  ).bind(key, value).run();
}

async function delSetting(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM app_settings WHERE key = ?').bind(key).run();
}

export async function isDriveConnected(env: Env): Promise<boolean> {
  return (await getSetting(env, KEY_REFRESH)) !== null;
}

/**
 * A valid access token, refreshed when needed.
 *
 * Access tokens last about an hour. Workers keep no memory between requests, so
 * the token is cached in app_settings with its expiry and reused until it is
 * nearly stale. The 60 second margin avoids handing back a token that expires
 * mid request.
 */
export async function getAccessToken(env: Env): Promise<string> {
  const cached = await getSetting(env, KEY_ACCESS);
  const expiresAt = Number((await getSetting(env, KEY_ACCESS_EXPIRES)) ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (cached && expiresAt > now + 60) return cached;

  const refreshToken = await getSetting(env, KEY_REFRESH);
  if (!refreshToken || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new DriveNotConnected();
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    // A revoked or invalid refresh token is unrecoverable: drop it so the UI
    // reports disconnected and Belle can reconnect, rather than failing forever.
    if (res.status === 400 || res.status === 401) {
      await delSetting(env, KEY_REFRESH);
    }
    throw new DriveNotConnected();
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  await putSetting(env, KEY_ACCESS, data.access_token);
  await putSetting(env, KEY_ACCESS_EXPIRES, String(now + data.expires_in));
  return data.access_token;
}

/** Swap the one time code from the consent screen for a lasting refresh token. */
export async function exchangeCodeForRefreshToken(
  env: Env,
  code: string,
  redirectUri: string
): Promise<void> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new DriveNotConnected();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);

  const data = (await res.json()) as { refresh_token?: string; access_token: string; expires_in: number };
  // Google only returns a refresh token when access_type=offline and the user
  // was actually prompted. connect.ts forces prompt=consent for this reason.
  if (!data.refresh_token) throw new Error('Google did not return a refresh token');

  const now = Math.floor(Date.now() / 1000);
  await putSetting(env, KEY_REFRESH, data.refresh_token);
  await putSetting(env, KEY_ACCESS, data.access_token);
  await putSetting(env, KEY_ACCESS_EXPIRES, String(now + data.expires_in));
}

/**
 * Forget the connection. Files already in Drive are left alone: they are the
 * owner's, and disconnecting an integration should not touch her documents.
 *
 * The root folder id is deliberately KEPT. Reconnecting the same account then
 * re-adopts the existing folder instead of making a second "MH Dunn Property
 * Documents" beside the first and splitting the tenant folders across the two.
 * If a DIFFERENT account connects, the stale id simply is not reachable under
 * the drive.file scope, folderAlive returns false, and a fresh root is made.
 * So keeping it is right in both cases.
 */
export async function disconnectDrive(env: Env): Promise<void> {
  await delSetting(env, KEY_REFRESH);
  await delSetting(env, KEY_ACCESS);
  await delSetting(env, KEY_ACCESS_EXPIRES);
}

async function createFolder(env: Env, name: string, parentId?: string): Promise<string> {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export type FolderStatus = 'alive' | 'gone' | 'unknown';

/**
 * Map a Drive files.get outcome to whether the folder should be treated as
 * present. Pulled out as a pure function so the rule that a transient failure
 * must NEVER be read as "gone" (which is what forked a second root folder) is
 * unit-testable without a live Drive.
 *   - 200, not trashed        -> alive
 *   - 200 but trashed, or 404 -> gone    (safe to adopt or create another)
 *   - anything else           -> unknown (401/403/429/5xx/network: do NOT fork)
 */
export function folderStatusFrom(
  ok: boolean,
  status: number,
  trashed: boolean | undefined
): FolderStatus {
  if (ok) return trashed === true ? 'gone' : 'alive';
  if (status === 404) return 'gone';
  return 'unknown';
}

/** Whether a Drive folder still exists, is trashed/gone, or could not be checked. */
async function folderStatus(env: Env, id: string): Promise<FolderStatus> {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${id}?fields=id,trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let trashed: boolean | undefined;
  if (res.ok) {
    const data = (await res.json()) as { trashed?: boolean };
    trashed = data.trashed === true;
  }
  return folderStatusFrom(res.ok, res.status, trashed);
}

/**
 * The id of an existing, non-trashed folder with this name that the app can
 * see, oldest first so duplicates always collapse back onto the original.
 * `parentId` scopes the search; omit it for the root folder, which the owner
 * may have moved anywhere in her Drive. Used only where the name is unique
 * (the root) — never for tenant folders, where two people can share a name.
 */
async function findFolder(env: Env, name: string, parentId?: string): Promise<string | null> {
  const token = await getAccessToken(env);
  const esc = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const clauses = [`name='${esc}'`, `mimeType='${FOLDER_MIME}'`, 'trashed=false'];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const q = encodeURIComponent(clauses.join(' and '));
  const res = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id)&orderBy=createdTime&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/**
 * The one root folder holding everything this app creates. Stored by id, so
 * Belle may rename it or move it anywhere in her Drive and it keeps working.
 * Recreated if she deletes it.
 */
export async function ensureRootFolder(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_ROOT_FOLDER);
  if (existing) {
    // Reuse unless the folder is DEFINITELY gone. On 'unknown' (a transient
    // check failure) we keep the stored id rather than forking a second root —
    // that fork is exactly the bug that created a duplicate "MH Dunn Property
    // Documents". If it turns out truly gone, the upload fails and retries.
    const status = await folderStatus(env, existing);
    if (status !== 'gone') return existing;
  }
  // No usable stored id: adopt an existing root already in the Drive before
  // making one, so a lost setting or an earlier duplicate heals to a single
  // canonical folder instead of spawning yet another.
  const id = (await findFolder(env, ROOT_FOLDER_NAME)) ?? (await createFolder(env, ROOT_FOLDER_NAME));
  await putSetting(env, KEY_ROOT_FOLDER, id);
  return id;
}

/**
 * The unit folder for a tenant's CURRENT unit, nested under the property folder.
 * Created and remembered on units.drive_folder_id. Named "Unit <n>".
 * Falls back to the root if the property folder cannot be created.
 */
async function ensureUnitFolderForTenant(env: Env, tenantId: string): Promise<string | null> {
  const unit = await env.DB.prepare(
    `SELECT u.id AS unit_id, u.unit_number AS unit_number, u.drive_folder_id AS unit_folder_id,
            u.property_id AS property_id,
            p.name AS property_name, p.address AS property_address
       FROM tenants t
       JOIN lease_tenants lt ON lt.tenant_id = t.id
       JOIN leases l ON l.id = lt.lease_id AND l.status != 'ended'
       JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = u.property_id
      WHERE t.id = ?
      ORDER BY l.start_date DESC LIMIT 1`
  )
    .bind(tenantId)
    .first<{
      unit_id: string; unit_number: string | null; unit_folder_id: string | null;
      property_id: string | null;
      property_name: string | null; property_address: string | null;
    }>();
  if (!unit?.unit_id) return null;
  if (unit.unit_folder_id) {
    const status = await folderStatus(env, unit.unit_folder_id);
    if (status !== 'gone') return unit.unit_folder_id;
  }
  const parent = unit.property_id
    ? ((await ensurePropertyFolder(env, unit.property_id)) ?? (await ensureRootFolder(env)))
    : await ensureRootFolder(env);
  const name = `Unit ${unit.unit_number || '?'}`;
  const id = await createFolder(env, name, parent);
  await env.DB.prepare('UPDATE units SET drive_folder_id = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(id, unit.unit_id)
    .run();
  return id;
}

/**
 * The shared "Prospective Tenants" folder under the root, holding applicants'
 * documents (application, lease, signed copies) so they are kept apart from
 * active tenants' folders. Created and remembered on first use.
 */
export async function ensureProspectiveFolder(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_PROSPECTIVE_FOLDER);
  if (existing) {
    const status = await folderStatus(env, existing);
    if (status !== 'gone') return existing;
  }
  const root = await ensureRootFolder(env);
  const id = (await findFolder(env, PROSPECTIVE_FOLDER_NAME, root)) ?? (await createFolder(env, PROSPECTIVE_FOLDER_NAME, root));
  await putSetting(env, KEY_PROSPECTIVE_FOLDER, id);
  return id;
}

/** The shared "Vendors" folder under the root. */
async function ensureVendorsRoot(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_VENDORS_FOLDER);
  if (existing) {
    const status = await folderStatus(env, existing);
    if (status !== 'gone') return existing;
  }
  const root = await ensureRootFolder(env);
  const id = (await findFolder(env, VENDORS_FOLDER_NAME, root)) ?? (await createFolder(env, VENDORS_FOLDER_NAME, root));
  await putSetting(env, KEY_VENDORS_FOLDER, id);
  return id;
}

/**
 * A handyman's own Drive folder under "Vendors", for files exchanged with them
 * in messaging. Created and remembered on handymen.drive_folder_id. Returns null
 * when the handyman does not exist.
 */
export async function ensureVendorFolder(env: Env, handymanId: string): Promise<string | null> {
  const h = await env.DB.prepare('SELECT id, name, drive_folder_id FROM handymen WHERE id = ?')
    .bind(handymanId)
    .first<{ id: string; name: string | null; drive_folder_id: string | null }>();
  if (!h?.id) return null;
  if (h.drive_folder_id) {
    const status = await folderStatus(env, h.drive_folder_id);
    if (status !== 'gone') return h.drive_folder_id;
  }
  const parent = await ensureVendorsRoot(env);
  const id = await createFolder(env, (h.name || 'Vendor').trim() || 'Vendor', parent);
  await env.DB.prepare('UPDATE handymen SET drive_folder_id = ? WHERE id = ?').bind(id, h.id).run();
  return id;
}

/**
 * The Drive folder for a unit, addressed by unit id (not via a tenant). Creates
 * and remembers it on units.drive_folder_id, nested under the property folder.
 * Returns null when the unit does not exist. Used to file expense receipts.
 */
export async function ensureUnitFolder(env: Env, unitId: string): Promise<string | null> {
  const unit = await env.DB.prepare(
    `SELECT u.id AS unit_id, u.unit_number AS unit_number, u.drive_folder_id AS unit_folder_id,
            u.property_id AS property_id
       FROM units u WHERE u.id = ?`
  ).bind(unitId).first<{
    unit_id: string; unit_number: string | null; unit_folder_id: string | null;
    property_id: string | null;
  }>();
  if (!unit?.unit_id) return null;
  if (unit.unit_folder_id) {
    const status = await folderStatus(env, unit.unit_folder_id);
    if (status !== 'gone') return unit.unit_folder_id;
  }
  const parent = unit.property_id
    ? ((await ensurePropertyFolder(env, unit.property_id)) ?? (await ensureRootFolder(env)))
    : await ensureRootFolder(env);
  const name = `Unit ${unit.unit_number || '?'}`;
  const id = await createFolder(env, name, parent);
  await env.DB.prepare('UPDATE units SET drive_folder_id = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(id, unit.unit_id).run();
  return id;
}

/**
 * The folder a tenant's documents go into. Nested so turnover and housemates
 * stay separated and organized:
 *   root ("MH Dunn Property Documents") → "<address> - Unit <n>" → "<First Last>"
 * A tenant with no current unit gets their own folder directly under the root.
 * Reused across uploads / receipts / payment proofs.
 */
export async function ensureTenantFolder(env: Env, tenantId: string): Promise<string> {
  const tenant = await env.DB.prepare(
    'SELECT id, first_name, last_name, drive_folder_id FROM tenants WHERE id = ?'
  )
    .bind(tenantId)
    .first<{ id: string; first_name: string; last_name: string; drive_folder_id: string | null }>();
  if (!tenant) throw new Error('Tenant not found');

  // The tenant's folder lives inside their unit folder (or the root if unplaced).
  const parent = (await ensureUnitFolderForTenant(env, tenantId)) ?? (await ensureRootFolder(env));

  if (tenant.drive_folder_id) {
    const status = await folderStatus(env, tenant.drive_folder_id);
    if (status !== 'gone') return tenant.drive_folder_id;
  }
  const name = `${tenant.first_name} ${tenant.last_name}`.trim() || tenant.id;
  const id = await createFolder(env, name, parent);
  await env.DB.prepare('UPDATE tenants SET drive_folder_id = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(id, tenantId)
    .run();
  return id;
}

/**
 * The Drive folder for a property, under the root. Created on first use and
 * remembered on properties.drive_folder_id. New unit folders nest under it.
 */
export async function ensurePropertyFolder(env: Env, propertyId: string): Promise<string | null> {
  const prop = await env.DB.prepare('SELECT id, name, address, drive_folder_id FROM properties WHERE id = ?')
    .bind(propertyId)
    .first<{ id: string; name: string; address: string | null; drive_folder_id: string | null }>();
  if (!prop) return null;
  if (prop.drive_folder_id) {
    const status = await folderStatus(env, prop.drive_folder_id);
    if (status !== 'gone') return prop.drive_folder_id;
  }
  const root = await ensureRootFolder(env);
  const folderName = (prop.address || prop.name || 'Property').trim();
  const id = await createFolder(env, folderName, root);
  await env.DB.prepare('UPDATE properties SET drive_folder_id = ? WHERE id = ?').bind(id, prop.id).run();
  return id;
}

/**
 * A named subfolder inside a tenant's Drive folder (e.g. "Lease", "Move In Photos").
 * Creates the subfolder if it doesn't exist yet. Uses findFolder to avoid duplicates.
 */
export async function ensureTenantSubfolder(env: Env, tenantId: string, subfolderName: string): Promise<string> {
  const parentId = await ensureTenantFolder(env, tenantId);
  const existing = await findFolder(env, subfolderName, parentId);
  if (existing) return existing;
  return createFolder(env, subfolderName, parentId);
}

/**
 * The Expenses folder for a property, nested under the property's Drive folder.
 * Optionally creates a yearly subfolder (e.g. "2026") inside it.
 */
export async function ensurePropertyExpensesFolder(env: Env, propertyId: string, year?: number): Promise<string | null> {
  const propFolder = await ensurePropertyFolder(env, propertyId);
  if (!propFolder) return null;
  const expensesId = (await findFolder(env, 'Expenses', propFolder)) ?? (await createFolder(env, 'Expenses', propFolder));
  if (!year) return expensesId;
  const yearName = String(year);
  return (await findFolder(env, yearName, expensesId)) ?? (await createFolder(env, yearName, expensesId));
}

/** Move a Drive file into a new parent, removing its current parents. Best-effort. */
async function moveDriveFile(env: Env, fileId: string, newParentId: string): Promise<void> {
  const token = await getAccessToken(env);
  const meta = await fetch(`${DRIVE_API}/files/${fileId}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meta.ok) return;
  const { parents } = (await meta.json()) as { parents?: string[] };
  const current = parents || [];
  if (current.length === 1 && current[0] === newParentId) return; // already there
  const removeParents = current.filter(p => p !== newParentId);
  const params = new URLSearchParams({ addParents: newParentId, fields: 'id' });
  if (removeParents.length) params.set('removeParents', removeParents.join(','));
  await fetch(`${DRIVE_API}/files/${fileId}?${params.toString()}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

/**
 * One-time reorg into the nested structure (Property/Unit → Tenant name → docs).
 * For each tenant with documents: nest their folder under their unit folder,
 * then move each of their documents into that tenant folder. Idempotent and
 * best-effort per file/folder, so it is safe to run more than once.
 */
export async function migrateDocumentFoldersToUnits(env: Env): Promise<{ moved: number; foldersNested: number }> {
  const { results: docs } = await env.DB.prepare(
    'SELECT id, drive_file_id, tenant_id FROM documents WHERE tenant_id IS NOT NULL AND drive_file_id IS NOT NULL'
  ).all<{ id: string; drive_file_id: string; tenant_id: string }>();

  let moved = 0;
  let foldersNested = 0;
  const handled = new Set<string>();
  for (const doc of docs || []) {
    try {
      // Nest the tenant's own folder under their unit folder (once per tenant).
      if (!handled.has(doc.tenant_id)) {
        handled.add(doc.tenant_id);
        const unitFolder = await ensureUnitFolderForTenant(env, doc.tenant_id);
        const tf = await env.DB.prepare('SELECT drive_folder_id FROM tenants WHERE id = ?')
          .bind(doc.tenant_id)
          .first<{ drive_folder_id: string | null }>();
        if (unitFolder && tf?.drive_folder_id) {
          await moveDriveFile(env, tf.drive_folder_id, unitFolder);
          foldersNested++;
        }
      }
      const tenantFolder = await ensureTenantFolder(env, doc.tenant_id);
      await moveDriveFile(env, doc.drive_file_id, tenantFolder);
      moved++;
    } catch { /* skip this file, keep going */ }
  }

  return { moved, foldersNested };
}

/** The Profile Photos folder, a subfolder of the app root, created on first use. */
async function ensurePhotoFolder(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_PHOTO_FOLDER);
  if (existing) {
    const status = await folderStatus(env, existing);
    if (status !== 'gone') return existing;
  }
  const root = await ensureRootFolder(env);
  const id = (await findFolder(env, PHOTO_FOLDER_NAME, root)) ?? (await createFolder(env, PHOTO_FOLDER_NAME, root));
  await putSetting(env, KEY_PHOTO_FOLDER, id);
  return id;
}

/**
 * Upload one file. Multipart carries the metadata (name, parent folder) and the
 * bytes in a single request, which is what lets the file land in the tenant's
 * folder with a real name rather than as an untitled blob.
 */
export async function uploadToDrive(
  env: Env,
  folderId: string,
  name: string,
  contentType: string,
  body: Blob
): Promise<{ id: string }> {
  const token = await getAccessToken(env);
  const boundary = `dunn${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });

  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    metadata,
    `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    body,
    `\r\n--${boundary}--\r\n`,
  ]);

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string };
}

/** Stream a file back from Drive. The caller re-serves the body. */
export async function getDriveFileStream(env: Env, fileId: string): Promise<Response> {
  const token = await getAccessToken(env);
  return fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Move a file to the Drive trash. */
/**
 * Deleting Drive files is DISABLED by policy (Belle, 2026-07-30): nothing the
 * app has stored in Google Drive is ever removed. A record can still be deleted
 * or hidden inside the app, but the underlying Drive file (receipt, photo,
 * document, signed lease) is always kept, so it can never be lost, even by a
 * mistaken delete or a receipt regeneration. Callers still invoke this on their
 * "replace"/"delete" paths; it simply retains the file instead. Re-enable only
 * deliberately, never as a side effect of a delete.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteDriveFile(_env: Env, _fileId: string): Promise<void> {
  // Intentionally a no-op: Drive files are retained.
  return;
}

/**
 * Upload a profile photo to the Profile Photos folder and return its Drive id.
 * When replacing, trashes the old file AFTER the new one is saved so a failure
 * never loses the existing photo.
 */
export async function saveProfilePhoto(env: Env, file: File, oldDriveId?: string): Promise<string> {
  const folderId = await ensurePhotoFolder(env);
  const name = `photo-${crypto.randomUUID()}`;
  const uploaded = await uploadToDrive(env, folderId, name, file.type || 'image/jpeg', file);
  if (oldDriveId) {
    try { await deleteDriveFile(env, oldDriveId); } catch { /* old file already gone is fine */ }
  }
  return uploaded.id;
}

/** The one folder that holds every maintenance-request photo. */
async function ensureMaintenanceFolder(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_MAINTENANCE_FOLDER);
  if (existing) {
    const status = await folderStatus(env, existing);
    if (status !== 'gone') return existing;
  }
  const root = await ensureRootFolder(env);
  const id = (await findFolder(env, MAINTENANCE_FOLDER_NAME, root)) ?? (await createFolder(env, MAINTENANCE_FOLDER_NAME, root));
  await putSetting(env, KEY_MAINTENANCE_FOLDER, id);
  return id;
}

/** Store a maintenance photo in the Maintenance Photos folder; replace any old one. */
export async function saveMaintenancePhoto(env: Env, file: File, oldDriveId?: string): Promise<string> {
  const folderId = await ensureMaintenanceFolder(env);
  const name = `maintenance-${crypto.randomUUID()}`;
  const uploaded = await uploadToDrive(env, folderId, name, file.type || 'image/jpeg', file);
  if (oldDriveId) {
    try { await deleteDriveFile(env, oldDriveId); } catch { /* old file already gone is fine */ }
  }
  return uploaded.id;
}

/** Remove a profile photo file from Drive. */
export async function removeProfilePhoto(env: Env, driveId: string): Promise<void> {
  await deleteDriveFile(env, driveId);
}
