import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  console.log('Session check request received');
  
  try {
    // Get session token from cookie
    const cookieHeader = request.headers.get('Cookie');
    const cookies = cookieHeader?.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    const sessionToken = cookies?.['session'];
    
    if (!sessionToken) {
      return new Response(JSON.stringify({ error: 'No session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Find session
    const now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare(
      'SELECT s.user_id, s.expires_at, u.name, u.email FROM session s JOIN user u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?'
    ).bind(sessionToken, now).first();
    
    if (!session) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Get user role
    const userRole = await env.DB.prepare('SELECT role FROM user_roles WHERE user_id = ?')
      .bind(session.user_id)
      .first();
    
    return new Response(JSON.stringify({ 
      success: true,
      user: {
        id: session.user_id,
        email: session.email,
        name: session.name,
        role: userRole?.role || 'viewer'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Session error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  // Handle sign-out
  const { request, env } = context;
  
  try {
    const cookieHeader = request.headers.get('Cookie');
    const cookies = cookieHeader?.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    const sessionToken = cookies?.['session'];
    
    if (sessionToken) {
      // Delete session from database
      await env.DB.prepare('DELETE FROM session WHERE token = ?').bind(sessionToken).run();
    }
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/',
      },
    });
    
  } catch (error) {
    console.error('Sign-out error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
