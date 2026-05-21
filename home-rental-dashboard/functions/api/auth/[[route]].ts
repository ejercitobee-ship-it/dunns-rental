import type { PagesFunction } from '@cloudflare/workers-types';
import { auth } from '../../lib/auth';

export const onRequest: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  
  try {
    // Check if DB binding exists
    if (!env.DB) {
      console.error('DB binding not found');
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const authInstance = auth(env.DB);
    
    // Let Better-Auth handle all auth routes
    return authInstance.handler(request);
  } catch (error) {
    console.error('Auth error:', error);
    return new Response(JSON.stringify({ error: 'Auth service error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
