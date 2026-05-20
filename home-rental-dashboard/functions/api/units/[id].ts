import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM units WHERE id = ?'
    ).bind(id).first();
    
    if (!result) {
      return Response.json({ success: false, error: 'Unit not found' }, { status: 404 });
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
      `UPDATE units SET
        property_id = ?, unit_number = ?, bedrooms = ?, bathrooms = ?, square_feet = ?, monthly_rent = ?, description = ?, status = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      body.propertyId,
      body.unitNumber,
      body.bedrooms || 1,
      body.bathrooms || 1,
      body.squareFeet || 0,
      body.monthlyRent || 0,
      body.description || null,
      body.status || 'vacant',
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
    await env.DB.prepare('DELETE FROM units WHERE id = ?').bind(id).run();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
