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

interface Env {
  DB: D1Database;
}

// POST /api/auth/reset-password - Reset password (for logged-in users)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  try {
    const body = await request.json() as {
      userId?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    
    const { userId, currentPassword, newPassword } = body;
    
    if (!userId || !newPassword) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (newPassword.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // If current password is provided, verify it
    if (currentPassword) {
      const account = await env.DB.prepare(
        'SELECT password FROM account WHERE user_id = ? AND provider_id = ?'
      ).bind(userId, 'credential').first();
      
      if (!account) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      const currentHash = await hashPassword(currentPassword);
      if (currentHash !== account.password) {
        return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    // Update password
    const newHash = await hashPassword(newPassword);
    const now = Math.floor(Date.now() / 1000);
    
    await env.DB.prepare(
      'UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?'
    ).bind(newHash, now, userId, 'credential').run();
    
    // Remove force_password_reset flag if exists
    await env.DB.prepare(
      'DELETE FROM user_metadata WHERE user_id = ? AND key = ?'
    ).bind(userId, 'force_password_reset').run();
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Password reset successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Reset password error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
