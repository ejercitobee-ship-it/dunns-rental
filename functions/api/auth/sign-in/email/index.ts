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
  
  console.log('Sign-in request received - START');
  
  try {
    console.log('Parsing request body...');
    const body = await request.json() as { email?: string; password?: string };
    console.log('Request body parsed:', body);
    
    const { email, password } = body;
    
    if (!email || !password) {
      console.log('Missing email or password');
      return new Response(JSON.stringify({ error: 'Missing email or password' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Looking up user:', email);
    // Find user by email
    const user = await env.DB.prepare('SELECT id, name, email FROM user WHERE email = ?')
      .bind(email)
      .first();
    
    console.log('User found:', user);
    
    if (!user) {
      console.log('User not found');
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Get password hash from account table
    const account = await env.DB.prepare('SELECT password FROM account WHERE user_id = ? AND provider_id = ?')
      .bind(user.id, 'credential')
      .first();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Verify password
    const passwordHash = await hashPassword(password);
    if (passwordHash !== account.password) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Get user role
    const userRole = await env.DB.prepare('SELECT role FROM user_roles WHERE user_id = ?')
      .bind(user.id)
      .first();
    
    // Check if user needs to reset password
    const forceReset = await env.DB.prepare(
      'SELECT value FROM user_metadata WHERE user_id = ? AND key = ?'
    ).bind(user.id, 'force_password_reset').first('value');
    
    // Create session
    const sessionToken = generateToken();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 7 * 24 * 60 * 60; // 7 days
    
    await env.DB.prepare(
      'INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.id, sessionToken, expiresAt, now, now).run();
    
    // Return success with session cookie
    return new Response(JSON.stringify({ 
      success: true, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        role: userRole?.role || 'viewer'
      },
      token: sessionToken,
      forcePasswordReset: forceReset === 'true'
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`,
      },
    });
    
  } catch (error) {
    console.error('Sign-in error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
