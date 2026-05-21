import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM tenants ORDER BY created_at DESC'
    ).all();
    
    return Response.json({ success: true, data: results });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const id = crypto.randomUUID();
    
    await env.DB.prepare(
      `INSERT INTO tenants (id, unit_id, property_id, first_name, last_name, email, phone, lease_start, lease_end, monthly_rent, security_deposit, status, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
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
      body.userId || 'system'
    ).run();
    
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
