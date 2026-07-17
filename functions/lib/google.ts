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

/** Thrown when Belle has not connected Drive. Endpoints turn this into a 503. */
export class DriveNotConnected extends Error {
  constructor() {
    super('Google Drive is not connected');
    this.name = 'DriveNotConnected';
  }
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function putSetting(env: Env, key: string, value: string): Promise<void> {
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

/** Confirm a Drive id still exists and is not in the trash. */
async function folderAlive(env: Env, id: string): Promise<boolean> {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${id}?fields=id,trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { trashed?: boolean };
  return data.trashed !== true;
}

/**
 * The one root folder holding everything this app creates. Stored by id, so
 * Belle may rename it or move it anywhere in her Drive and it keeps working.
 * Recreated if she deletes it.
 */
async function ensureRootFolder(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_ROOT_FOLDER);
  if (existing && (await folderAlive(env, existing))) return existing;
  const id = await createFolder(env, 'MH Dunn Property Documents');
  await putSetting(env, KEY_ROOT_FOLDER, id);
  return id;
}

/**
 * A tenant's folder, created on first use and remembered on the tenant row.
 * Named for the person so the folder is meaningful when Belle opens Drive.
 */
export async function ensureTenantFolder(env: Env, tenantId: string): Promise<string> {
  const tenant = await env.DB.prepare(
    'SELECT id, first_name, last_name, drive_folder_id FROM tenants WHERE id = ?'
  )
    .bind(tenantId)
    .first<{ id: string; first_name: string; last_name: string; drive_folder_id: string | null }>();
  if (!tenant) throw new Error('Tenant not found');

  if (tenant.drive_folder_id && (await folderAlive(env, tenant.drive_folder_id))) {
    return tenant.drive_folder_id;
  }

  const root = await ensureRootFolder(env);
  const name = `${tenant.first_name} ${tenant.last_name}`.trim() || tenant.id;
  const id = await createFolder(env, name, root);
  await env.DB.prepare('UPDATE tenants SET drive_folder_id = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(id, tenantId)
    .run();
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
export async function deleteDriveFile(env: Env, fileId: string): Promise<void> {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404 means it is already gone, which is the outcome we wanted.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete failed: ${res.status}`);
  }
}
