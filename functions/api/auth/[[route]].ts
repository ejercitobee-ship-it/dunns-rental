import type { PagesFunction } from '@cloudflare/workers-types';
import { auth } from '../../lib/auth';

// Handle all HTTP methods
export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => handleAuth(context);
export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (context) => handleAuth(context);
export const onRequestPut: PagesFunction<{ DB: D1Database }> = async (context) => handleAuth(context);
export const onRequestDelete: PagesFunction<{ DB: D1Database }> = async (context) => handleAuth(context);
export const onRequestPatch: PagesFunction<{ DB: D1Database }> = async (context) => handleAuth(context);

async function handleAuth(context: EventContext<{ DB: D1Database }, any, any>): Promise<Response> {
  const { request, env } = context;
  
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
}
