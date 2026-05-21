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
      'SELECT * FROM tenants ORDER BY created_at DESC'
    ).all();
    
    // Transform snake_case to camelCase for frontend compatibility
    const transformedResults = results?.map((tenant: Record<string, unknown>) => ({
      id: tenant.id,
      unitId: tenant.unit_id,
      propertyId: tenant.property_id,
      firstName: tenant.first_name,
      lastName: tenant.last_name,
      email: tenant.email,
      phone: tenant.phone,
      leaseStart: tenant.lease_start,
      leaseEnd: tenant.lease_end,
      monthlyRent: tenant.monthly_rent,
      securityDeposit: tenant.security_deposit,
      status: tenant.status,
      notes: tenant.notes,
      userId: tenant.user_id,
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at,
    })) || [];
    
    return Response.json({ success: true, data: transformedResults });
  } catch (error) {
    console.error('Error fetching tenants:', error);
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (context) => {
  console.log('Tenants POST handler invoked');
  
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
    
    // Verify the unit exists if provided
    if (body.unitId) {
      console.log('Verifying unit exists:', body.unitId);
      const unit = await env.DB.prepare('SELECT id FROM units WHERE id = ?')
        .bind(body.unitId)
        .first();
      
      if (!unit) {
        console.error('Unit not found:', body.unitId);
        return Response.json({ success: false, error: 'Unit not found' }, { status: 404 });
      }
      console.log('Unit verified:', unit);
    }
    
    // Verify the property exists if provided
    if (body.propertyId) {
      console.log('Verifying property exists:', body.propertyId);
      const property = await env.DB.prepare('SELECT id FROM properties WHERE id = ?')
        .bind(body.propertyId)
        .first();
      
      if (!property) {
        console.error('Property not found:', body.propertyId);
        return Response.json({ success: false, error: 'Property not found' }, { status: 404 });
      }
      console.log('Property verified:', property);
    }
    
    console.log('Generating UUID...');
    const id = crypto.randomUUID();
    console.log('Generated ID:', id);
    
    console.log('Preparing database query...');
    const query = `INSERT INTO tenants (id, unit_id, property_id, first_name, last_name, email, phone, lease_start, lease_end, monthly_rent, security_deposit, status, notes, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`;
    console.log('Query:', query);
    
    const params = [
      id,
      body.unitId || null,
      body.propertyId || null,
      body.firstName,
      body.lastName,
      body.email,
      body.phone || null,
      body.leaseStart || null,
      body.leaseEnd || null,
      body.monthlyRent || 0,
      body.securityDeposit || 0,
      body.status || 'active',
      body.notes || null,
      userId
    ];
    console.log('Params:', JSON.stringify(params));
    
    console.log('Executing database query...');
    await env.DB.prepare(query).bind(...params).run();
    
    console.log('Tenant created successfully:', id);
    return Response.json({ success: true, data: { id, ...body, user_id: userId } }, { status: 201 });
  } catch (error) {
    console.error('Error creating tenant:', error);
    console.error('Error message:', (error as Error).message);
    console.error('Error stack:', (error as Error).stack);
    return Response.json({ 
      success: false, 
      error: (error as Error).message,
      stack: (error as Error).stack 
    }, { status: 500 });
  }
};
