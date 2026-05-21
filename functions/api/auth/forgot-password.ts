import type { PagesFunction } from '@cloudflare/workers-types';

// Generate a random reset token
function generateResetToken(): string {
  return crypto.randomUUID();
}

interface Env {
  DB: D1Database;
}

// POST /api/auth/forgot-password - Request password reset
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  try {
    const body = await request.json() as { email?: string };
    const { email } = body;
    
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Find user by email
    const user = await env.DB.prepare('SELECT id, email, name FROM user WHERE email = ?')
      .bind(email)
      .first();
    
    if (!user) {
      // Don't reveal if email exists or not for security
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'If an account exists with this email, you will receive password reset instructions.'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Generate reset token
    const resetToken = generateResetToken();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 60 * 60; // 1 hour expiry
    
    // Store reset token
    await env.DB.prepare(
      'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.id, resetToken, expiresAt, now).run();
    
    // In a real app, you would send an email here
    // For now, return the token in the response (for testing)
    console.log(`Password reset requested for ${email}. Token: ${resetToken}`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'If an account exists with this email, you will receive password reset instructions.',
      // Include token in response for testing (remove in production)
      resetToken,
      userId: user.id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
