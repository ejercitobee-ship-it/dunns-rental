import type { PagesFunction } from '@cloudflare/workers-types';

// Helper to get user ID from session cookie
async function getUserIdFromSession(env: { DB: D1Database }, request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
  
  const sessionToken = cookies['session'];
  if (!sessionToken) return null;
  
  const now = Math.floor(Date.now() / 1000);
  const session = await env.DB.prepare(
    'SELECT user_id FROM session WHERE token = ? AND expires_at > ?'
  ).bind(sessionToken, now).first();
  
  return session?.user_id as string || null;
}

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM units ORDER BY created_at DESC'
    ).all();
    
    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('Error fetching units:', error);
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (context) => {
  console.log('Units POST handler invoked');
  
  try {
    const { env, request } = context;
    
    // Get user ID from session
    const userId = await getUserIdFromSession(env, request);
    console.log('User ID from session:', userId);
    
    if (!userId) {
      console.error('No valid session found');
      return Response.json({ success: false, error: 'Unauthorized - No valid session' }, { status: 401 });
    }
    
    console.log('Parsing request body...');
    const body = await request.json();
    console.log('Request body:', JSON.stringify(body));
    
    console.log('Generating UUID...');
    const id = crypto.randomUUID();
    console.log('Generated ID:', id);
    
    console.log('Preparing database query...');
    const query = `INSERT INTO units (id, property_id, unit_number, bedrooms, bathrooms, square_feet, monthly_rent, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`;
    console.log('Query:', query);
    
    const params = [
      id,
      body.propertyId,
      body.unitNumber,
      body.bedrooms || 1,
      body.bathrooms || 1,
      body.squareFeet || 0,
      body.monthlyRent || 0,
      body.description || null,
      body.status || 'vacant'
    ];
    console.log('Params:', JSON.stringify(params));
    
    console.log('Executing database query...');
    await env.DB.prepare(query).bind(...params).run();
    
    console.log('Unit created successfully:', id);
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    console.error('Error creating unit:', error);
    console.error('Error message:', (error as Error).message);
    console.error('Error stack:', (error as Error).stack);
    return Response.json({ 
      success: false, 
      error: (error as Error).message,
      stack: (error as Error).stack 
    }, { status: 500 });
  }
};
