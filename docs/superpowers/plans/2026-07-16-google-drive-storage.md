# Google Drive Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store tenant documents in Belle's Google Drive, one folder per tenant, so she can open and browse them herself, and make the Documents feature work for the first time.

**Architecture:** Belle clicks Connect Google Drive once in Settings. The app keeps a refresh token in `app_settings`, mints short lived access tokens as needed, and creates a root folder plus a folder per tenant on demand. The existing `functions/api/documents/` endpoints are rewired from R2 to Drive; their shape does not change, so the portal built later needs no knowledge of where bytes live.

**Tech Stack:** Cloudflare Pages Functions, D1, Google Drive API v3, OAuth 2.0, React 19.

## Global Constraints

- **Scope is `https://www.googleapis.com/auth/drive.file` and must stay that way.** The app may only touch files it created. It cannot read the rest of Belle's Drive. Widening this is a decision for Belle, not an implementer.
- The OAuth client is **Internal** audience, so refresh tokens do not expire and no Google verification is needed.
- **Client ID:** `826883581864-lcd02c23qaol5dbv2d9j4hf6nu62shc4.apps.googleusercontent.com`. Secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` already exist on the Pages project. Never hardcode the secret; never commit it.
- Registered redirect URIs, which must match byte for byte:
  - `https://dunns-rental.pages.dev/api/google/callback`
  - `http://localhost:8790/api/google/callback`
  Derive the redirect URI from the request origin so both work.
- Only a user with `settings_edit` may connect or disconnect Drive. It is Belle's Google account being linked.
- Every endpoint keeps the auth pattern: `const auth = await requirePermission(env, request, '<perm>');` then `if (auth instanceof Response) return auth;`.
- Rows are snake_case in D1, camelCase over the API; conversion only in `functions/lib/serializers.ts`.
- No dashes as punctuation in user visible copy. A lone "—" as an empty cell placeholder is house convention.
- Design system only: `src/components/ui/` and tokens in `src/index.css`. No new colors or fonts.
- When Drive is not connected, endpoints degrade with a clear message, exactly as they do today for R2. They never crash.

## Existing interfaces

- `functions/lib/session.ts`: `Env` (`DB`, `DOCS?`, `RESEND_API_KEY?`, `MAIL_FROM?`), `requirePermission`, `requireUser`, `jsonOk`, `jsonError`, `serverError`, `SessionUser`.
- `app_settings` (migration 0003): `key` TEXT PRIMARY KEY, `value` TEXT NOT NULL, `updated_at`.
- `documents` (migration 0006): currently `r2_key TEXT NOT NULL`. **Production holds 0 documents**, verified, so the table can be reshaped rather than migrated.
- `functions/api/documents/index.ts` (GET list, POST upload) and `[id].ts` (GET download, DELETE). Both currently 503 when `env.DOCS` is unbound, which is always.
- `functions/lib/serializers.ts`: `serializeDoc`.

## File structure

- Create `migrations/0009_drive_storage.sql` — reshape `documents`, add `tenants.drive_folder_id`.
- Create `functions/lib/google.ts` — tokens and every Drive call. Nothing else talks to Google.
- Create `functions/api/google/connect.ts`, `callback.ts`, `status.ts`, `disconnect.ts`.
- Modify `functions/api/documents/index.ts` and `[id].ts` — R2 to Drive.
- Modify `functions/lib/session.ts` — add the two Google secrets to `Env`.
- Modify `functions/lib/serializers.ts` — `serializeDoc` returns `driveFileId`.
- Modify `src/pages/Settings.tsx` — the Connect Google Drive card.
- Modify `.gitignore` — ignore `.dev.vars`.

---

### Task 1: Schema, and stop committing local secrets

**Files:**
- Create: `migrations/0009_drive_storage.sql`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `documents.drive_file_id`, `tenants.drive_folder_id`.

- [ ] **Step 1: Ignore `.dev.vars`**

Local testing needs the Google client secret in `.dev.vars`, which wrangler reads automatically. It is not currently ignored, so it would be committed. Append to `.gitignore`:

```
# Local secrets for `wrangler pages dev`. Never commit.
.dev.vars
```

- [ ] **Step 2: Write the migration**

```sql
-- Documents move from R2 to Google Drive. The table is recreated rather than
-- altered because r2_key is NOT NULL and meaningless now, and SQLite cannot
-- drop a NOT NULL. This is safe: production holds 0 documents, verified before
-- writing this, and R2 was never enabled so no file was ever stored.
DROP TABLE IF EXISTS documents;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- The file's id in Google Drive. The bytes live in Belle's Drive.
  drive_file_id TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  property_id TEXT,
  tenant_id TEXT,
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id);

-- The tenant's own folder in Drive, created on their first upload and then
-- reused. Tracked by id, so Belle can rename or move the folder freely.
ALTER TABLE tenants ADD COLUMN drive_folder_id TEXT;
```

- [ ] **Step 3: Apply locally and confirm**

```bash
npx wrangler d1 migrations apply dunns-rental-db --local
npx wrangler d1 execute dunns-rental-db --local --command "SELECT COUNT(*) AS c FROM pragma_table_info('documents') WHERE name='drive_file_id'"
npx wrangler d1 execute dunns-rental-db --local --command "SELECT COUNT(*) AS c FROM pragma_table_info('tenants') WHERE name='drive_folder_id'"
```
Expected: `c` is 1 for both. **Never `--remote`.**

- [ ] **Step 4: Commit**

```bash
git add migrations/0009_drive_storage.sql .gitignore
git commit -m "feat: reshape documents for Drive storage, and ignore .dev.vars"
```

---

### Task 2: The Google module

Everything that talks to Google lives here. No endpoint calls Google directly.

**Files:**
- Create: `functions/lib/google.ts`
- Modify: `functions/lib/session.ts`

**Interfaces:**
- Produces:
  - `isDriveConnected(env): Promise<boolean>`
  - `getAccessToken(env): Promise<string>` (throws `DriveNotConnected` when there is no refresh token)
  - `exchangeCodeForRefreshToken(env, code, redirectUri): Promise<void>`
  - `disconnectDrive(env): Promise<void>`
  - `ensureTenantFolder(env, tenantId): Promise<string>` returns the Drive folder id
  - `uploadToDrive(env, folderId, name, contentType, body: Blob): Promise<{ id: string }>`
  - `getDriveFileStream(env, fileId): Promise<Response>`
  - `deleteDriveFile(env, fileId): Promise<void>`
  - `class DriveNotConnected extends Error`

- [ ] **Step 1: Extend Env**

In `functions/lib/session.ts`, add to `Env`:

```ts
  /** Google OAuth client id for Drive storage. */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client secret. Never logged, never returned. */
  GOOGLE_CLIENT_SECRET?: string;
```

- [ ] **Step 2: Write the module**

```ts
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

/** Forget the connection. Files already in Drive are left alone. */
export async function disconnectDrive(env: Env): Promise<void> {
  await delSetting(env, KEY_REFRESH);
  await delSetting(env, KEY_ACCESS);
  await delSetting(env, KEY_ACCESS_EXPIRES);
  await delSetting(env, KEY_ROOT_FOLDER);
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
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json`
Expected: no output.

```bash
git add functions/lib/google.ts functions/lib/session.ts
git commit -m "feat: the Google Drive module, tokens and file operations"
```

---

### Task 3: Connect, callback, status, disconnect

**Files:**
- Create: `functions/api/google/connect.ts`, `functions/api/google/callback.ts`, `functions/api/google/status.ts`, `functions/api/google/disconnect.ts`

**Interfaces:**
- Consumes: `exchangeCodeForRefreshToken`, `isDriveConnected`, `disconnectDrive`, `DRIVE_SCOPE`.
- Produces: `GET /api/google/connect`, `GET /api/google/callback`, `GET /api/google/status`, `POST /api/google/disconnect`.

- [ ] **Step 1: connect.ts**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonError } from '../../lib/session';
import { DRIVE_SCOPE } from '../../lib/google';

/**
 * GET /api/google/connect — send Belle to Google's consent screen.
 *
 * access_type=offline plus prompt=consent is what makes Google return a refresh
 * token. Without prompt=consent, a second authorisation returns none and the
 * connection silently cannot be renewed.
 *
 * state carries a random value in a short lived cookie and is checked on the
 * way back, so a stray callback cannot connect an account we did not ask for.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return auth;

  if (!env.GOOGLE_CLIENT_ID) return jsonError('Google is not configured', 503);

  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${origin}/api/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `google_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
};
```

- [ ] **Step 2: callback.ts**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, parseCookies } from '../../lib/session';
import { exchangeCodeForRefreshToken } from '../../lib/google';

/** Send the user back to Settings with a short result note in the query. */
function backToSettings(origin: string, result: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/settings?drive=${result}`,
      'Set-Cookie': 'google_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    },
  });
}

/**
 * GET /api/google/callback — Google returns here with a one time code.
 *
 * This is a browser redirect, so it must be a GET and cannot return JSON. It
 * still demands settings_edit: the callback is what actually stores the
 * connection, so it cannot be left open to anyone who guesses the URL.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const origin = new URL(request.url).origin;

  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return backToSettings(origin, 'denied');

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = parseCookies(request).google_oauth_state;

  if (url.searchParams.get('error')) return backToSettings(origin, 'cancelled');
  if (!code) return backToSettings(origin, 'failed');
  if (!state || !cookieState || state !== cookieState) return backToSettings(origin, 'failed');

  try {
    await exchangeCodeForRefreshToken(env, code, `${origin}/api/google/callback`);
    return backToSettings(origin, 'connected');
  } catch {
    return backToSettings(origin, 'failed');
  }
};
```

- [ ] **Step 3: status.ts and disconnect.ts**

```ts
// status.ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { isDriveConnected } from '../../lib/google';

/** GET /api/google/status — whether Drive is connected. Never returns tokens. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_view');
  if (auth instanceof Response) return auth;
  try {
    return jsonOk({ success: true, data: { connected: await isDriveConnected(env) } });
  } catch {
    return serverError();
  }
};
```

```ts
// disconnect.ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { disconnectDrive } from '../../lib/google';

/**
 * POST /api/google/disconnect — forget the connection.
 * Files already in Drive are left where they are: they are Belle's.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return auth;
  try {
    await disconnectDrive(env);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json` (no output).
```bash
git add functions/api/google/
git commit -m "feat: connect, callback, status and disconnect for Google Drive"
```

---

### Task 4: Rewire the documents endpoints to Drive

**Files:**
- Modify: `functions/api/documents/index.ts`, `functions/api/documents/[id].ts`
- Modify: `functions/lib/serializers.ts`

**Interfaces:**
- Consumes: `ensureTenantFolder`, `uploadToDrive`, `getDriveFileStream`, `deleteDriveFile`, `DriveNotConnected`.
- Produces: the same endpoint shapes as today. Callers see no difference beyond `driveFileId` replacing `r2Key`.

- [ ] **Step 1: Update serializeDoc**

In `functions/lib/serializers.ts`, change the document serializer so it exposes `driveFileId` instead of `r2Key`. Keep every other field exactly as it is.

- [ ] **Step 2: Rewrite the upload**

In `functions/api/documents/index.ts`, replace the R2 branch of `onRequestPost`. The endpoint keeps its permission, its multipart form parsing, and its response shape. Replace `if (!env.DOCS)` with a `DriveNotConnected` catch, and the `env.DOCS.put` with:

```ts
    // A document must belong to a tenant, because Drive folders are per tenant.
    if (!tenantId) return jsonError('A tenant is required', 400);

    const folderId = await ensureTenantFolder(env, tenantId);
    const uploaded = await uploadToDrive(
      env,
      folderId,
      file.name,
      file.type || 'application/octet-stream',
      file
    );

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, file.name, uploaded.id, file.type || null, file.size, propertyId, tenantId, auth.id).run();
```

Wrap the handler body so `DriveNotConnected` becomes a friendly 503:

```ts
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
```

- [ ] **Step 3: Rewrite download and delete**

In `functions/api/documents/[id].ts`, `onRequestGet` streams from Drive:

```ts
    const upstream = await getDriveFileStream(env, meta.drive_file_id);
    if (!upstream.ok) return jsonError('Document not found', 404);

    return new Response(upstream.body, {
      headers: {
        'Content-Type': meta.content_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${meta.name}"`,
      },
    });
```

`onRequestDelete` trashes the Drive file, then removes the row. If Drive is not connected, still remove the row rather than stranding it, and say so in a comment.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json` (no output) and `npm run build` (green).
```bash
git add functions/api/documents/ functions/lib/serializers.ts
git commit -m "feat: documents are stored in Google Drive rather than R2"
```

---

### Task 5: The Connect Google Drive card in Settings

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: API client**

Add to `src/lib/api.ts`, matching the existing clients:

```ts
export const googleApi = {
  status: () => apiRequest('/api/google/status'),
  disconnect: () => apiRequest('/api/google/disconnect', { method: 'POST' }),
};
```

- [ ] **Step 2: The card**

In `src/pages/Settings.tsx` add a Document storage card:

- Reads `googleApi.status()` on mount. **Every hook before any early return**: this app has had a React #310 white screen from a `useMemo` after a return.
- Connected: show "Connected to Google Drive", explain where files go, and a Disconnect button.
- Not connected: explain plainly and offer a Connect Google Drive button that does `window.location.href = '/api/google/connect'`. This is a full page redirect on purpose, not fetch: it is an OAuth flow and must leave the app.
- Read the `?drive=` result the callback sets and toast accordingly: `connected` success; `cancelled` info; `denied` or `failed` error. Then clear the query so a refresh does not toast again.

Copy, no dashes:

> Tenant documents are stored in your Google Drive, in a folder for each tenant. Only files this app creates are visible to it. It cannot see the rest of your Drive.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -b` (no output) and `npm run build` (green).
```bash
git add src/pages/Settings.tsx src/lib/api.ts
git commit -m "feat: connect Google Drive from Settings"
```

---

### Task 6: Prove it against real Google, then ship

**Files:** none. Verification.

This talks to a third party, so it is exercised for real rather than reasoned about.

- [ ] **Step 1: Local secrets**

Create `.dev.vars` in the repo root (already gitignored by Task 1):

```
GOOGLE_CLIENT_ID=826883581864-lcd02c23qaol5dbv2d9j4hf6nu62shc4.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<ask Belle, or copy from the Cloudflare dashboard>
```

- [ ] **Step 2: Run it**

```bash
npm run build
npx wrangler pages dev dist --port 8790 --compatibility-date 2025-05-20
```
Port 8790 matters: it is the registered redirect URI. Any other port and Google refuses. Never `--remote`.

- [ ] **Step 3: Connect and prove the round trip**

Sign in as a staff account with `settings_edit`. In Settings, click Connect Google Drive, approve on Google's screen, and confirm it returns to Settings saying connected.

Then, on a tenant, upload a document. Confirm all of:
1. The upload succeeds and the document is listed.
2. **In Belle's actual Drive**, a folder `MH Dunn Property Documents` exists, with a subfolder named for the tenant, containing the file.
3. Downloading from the app returns the same file.
4. Deleting from the app removes it from the app and trashes it in Drive.
5. A second upload for the same tenant reuses the folder rather than making a duplicate.

- [ ] **Step 4: Prove it degrades**

Disconnect Drive in Settings. Attempt an upload. Expected: a clear "Google Drive is not connected" message and a 503, not a crash and not a white screen.

- [ ] **Step 5: Full check**

```bash
npx tsc -b && npm run build && npm test
```
Expected: clean, green, 35 tests passing.

- [ ] **Step 6: Ship**

```bash
npx wrangler d1 migrations apply dunns-rental-db --remote
```
Confirm 0009 applies. Then merge to `main` and push, which deploys. Afterwards, in the live app, Belle clicks Connect Google Drive once. The secrets are already on the Pages project.

Note: the `DOCS` binding stays commented out in `wrangler.jsonc` and R2 is never enabled. Drive replaces it.

---

## Self-review

**Spec coverage.** Files in Belle's Drive: Task 2, `ensureRootFolder` and `ensureTenantFolder`. A folder per tenant: Task 2, stored on `tenants.drive_folder_id`. Connect once: Tasks 3 and 5. `drive.file` only: Task 2, `DRIVE_SCOPE`, and the constraint above. Documents feature works at last: Task 4. Graceful when unconnected: Tasks 2 and 4 via `DriveNotConnected`. Proven for real: Task 6.

**Placeholder scan.** One deliberate blank: the client secret in `.dev.vars` in Task 6, which must not be written into a plan committed to git. Every other value is exact.

**Type consistency.** `ensureTenantFolder` returns a folder id string, consumed by `uploadToDrive(env, folderId, ...)`. `uploadToDrive` returns `{ id }`, stored as `documents.drive_file_id` and read back by `getDriveFileStream(env, fileId)`. `DriveNotConnected` is thrown in Task 2 and caught in Task 4.

**Known limit, by design.** `drive.file` means a file Belle adds to a tenant folder by hand is invisible to the app. Documents flow app to Drive, one way. She accepted this in exchange for the app being unable to read the rest of her Drive.
