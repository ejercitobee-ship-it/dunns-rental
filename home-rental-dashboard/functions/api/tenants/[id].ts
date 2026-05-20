import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM tenants WHERE id = ?'
    ).bind(id).first();
    
    if (!result) {
      return Response.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }
    
    return Response.json({ success: true, data: result });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};

export const onRequestPut: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, request, params } = context;
  const id = params.id as string;
  
  try {
    const body = await request.json();
    
    await env.DB.prepare(
      `UPDATE tenants SET
        unit_id = ?, property_id = ?, first_name = ?, last_name = ?, email = ?, phone = ?,
        lease_start = ?, lease_end = ?, monthly_rent = ?, security_deposit = ?, status = ?, notes = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
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
      id
    ).run();
    
    return Response.json({ success: true, data: { id, ...body } });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};

export const onRequestDelete: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  
  try {
    await env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id).run();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
