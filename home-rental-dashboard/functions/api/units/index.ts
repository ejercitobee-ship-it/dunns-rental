import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM units ORDER BY created_at DESC'
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
      `INSERT INTO units (id, property_id, unit_number, bedrooms, bathrooms, square_feet, monthly_rent, description, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.propertyId,
      body.unitNumber,
      body.bedrooms || 1,
      body.bathrooms || 1,
      body.squareFeet || 0,
      body.monthlyRent || 0,
      body.description || null,
      body.status || 'vacant'
    ).run();
    
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
