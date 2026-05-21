import type { PagesFunction } from '@cloudflare/workers-types';

// Simple password hashing using Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Generate a random session token
function generateToken(): string {
  return crypto.randomUUID();
}

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  console.log('Sign-up request received at sign-up.email.ts');
  
  try {
    const body = await request.json() as { email?: string; password?: string; name?: string };
    const { email, password, name } = body;
    
    if (!email || !password || !name) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Check if user already exists (using Better-Auth's 'user' table)
    const existingUser = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first();
    
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'User already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Create user using Better-Auth's schema
    const userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000); // unix timestamp
    
    await env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, name, email, 0, null, now, now).run();
    
    // Store password in account table (Better-Auth's way)
    await env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now).run();
    
    // Check if this is the first user - make them super_admin
    const userCount = await env.DB.prepare('SELECT COUNT(*) as count FROM user').first('count');
    const role = userCount === 1 ? 'super_admin' : 'viewer';
    
    await env.DB.prepare(
      'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, role, now, now).run();
    
    // Create session using Better-Auth's session table
    const sessionToken = generateToken();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days in unix timestamp
    
    await env.DB.prepare(
      'INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, sessionToken, expiresAt, now, now).run();
    
    // Return success with session cookie
    return new Response(JSON.stringify({ 
      success: true, 
      user: { id: userId, email, name, role },
      token: sessionToken 
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`,
      },
    });
    
  } catch (error) {
    console.error('Sign-up error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
