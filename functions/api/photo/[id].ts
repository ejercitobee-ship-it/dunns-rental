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
    return new Response(driveRes.body, {
      status: 200,
      headers: {
        'Content-Type': driveRes.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
