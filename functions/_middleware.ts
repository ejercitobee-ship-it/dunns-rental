import type { PagesFunction } from '@cloudflare/workers-types';

// The SPA and the API are served from the same Pages domain, so cross-origin
// requests are never expected. We only echo an Access-Control-Allow-Origin
// header when the request's Origin matches our own origin. This prevents any
// other website from making credentialed (cookie-bearing) requests on behalf
// of a logged-in user.
function allowedOrigin(request: Request, selfOrigin: string): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null; // same-origin / non-browser request: no CORS needed
  return origin === selfOrigin ? origin : null;
}

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  const selfOrigin = new URL(request.url).origin;
  const origin = allowedOrigin(request, selfOrigin);

  if (request.method === 'OPTIONS') {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    return new Response(null, { status: 204, headers });
  }

  const response = await context.next();

  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.append('Vary', 'Origin');
  }

  return response;
};
