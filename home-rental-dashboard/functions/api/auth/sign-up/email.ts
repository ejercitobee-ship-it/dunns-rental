import type { PagesFunction } from '@cloudflare/workers-types';
import { auth } from '../../../lib/auth';

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { request, env } = context;
  
  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const authInstance = auth(env.DB);
    return authInstance.handler(request);
  } catch (error) {
    console.error('Auth error:', error);
    return new Response(JSON.stringify({ error: 'Auth service error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
