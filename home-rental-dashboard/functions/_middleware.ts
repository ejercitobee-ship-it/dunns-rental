import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': url.origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  const response = await context.next();
  
  // Add CORS headers to all responses
  response.headers.set('Access-Control-Allow-Origin', url.origin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  
  return response;
};
