import type { PagesFunction } from '@cloudflare/workers-types';
import { auth } from '../../lib/auth';

export const onRequest: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  
  const authInstance = auth(env.DB);
  
  // Let Better-Auth handle all auth routes
  return authInstance.handler(request);
};
