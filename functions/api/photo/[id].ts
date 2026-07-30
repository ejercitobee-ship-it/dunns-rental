import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser } from '../../lib/session';
import { getDriveFileStream } from '../../lib/google';

/**
 * GET /api/photo/:id — stream a profile photo from Drive. Any logged-in user
 * may call it, but a photo id is only ever exposed to a viewer already
 * authorized to see that person (via the scoped serializers). Ids are
 * unguessable Drive ids. The browser caches by URL.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const driveRes = await getDriveFileStream(env, params.id as string);
    if (!driveRes.ok) return new Response('Not found', { status: 404 });

    // This route serves profile photos AND message attachments, which can be any
    // file type. Only well-known raster images are allowed to render inline; any
    // other type (HTML, SVG, PDF, ...) is forced to download so a malicious
    // attachment can never execute script in this origin. nosniff stops the
    // browser from re-interpreting a mistyped file, and the sandbox CSP neuters
    // anything that is still opened as a document.
    const ct = (driveRes.headers.get('Content-Type') || 'image/jpeg');
    const base = ct.toLowerCase().split(';')[0].trim();
    const inlineOk = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(base);
    const headers: Record<string, string> = {
      'Content-Type': ct,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    if (!inlineOk) headers['Content-Disposition'] = 'attachment';

    return new Response(driveRes.body, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
