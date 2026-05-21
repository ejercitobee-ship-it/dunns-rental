import type { PagesFunction } from '@cloudflare/workers-types';

// Generate a random temporary password
function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Simple password hashing using Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  try {
    const body = await request.json() as {
      firstName?: string;
      lastName?: string;
      email?: string;
      roleId?: string;
      createdBy?: string;
    };
    
    const { firstName, lastName, email, roleId, createdBy } = body;
    
    if (!firstName || !lastName || !email || !roleId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Check if user already exists
    const existingUser = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first();
    
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'User already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Generate temporary password
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    
    // Create user
    const userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const name = `${firstName} ${lastName}`;
    
    await env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, name, email, 0, null, now, now).run();
    
    // Store password in account table
    await env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now).run();
    
    // Assign role
    await env.DB.prepare(
      'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, roleId, now, now).run();
    
    // Store temp password flag - user must reset on first login
    await env.DB.prepare(
      'INSERT INTO user_metadata (id, user_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, 'force_password_reset', 'true', now, now).run();
    
    // Return success with temp password (admin should share this with user)
    return new Response(JSON.stringify({ 
      success: true, 
      user: { 
        id: userId, 
        email, 
        name,
        role: roleId
      },
      tempPassword,
      message: 'User created successfully. Please share the temporary password with the user.'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Create user error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
