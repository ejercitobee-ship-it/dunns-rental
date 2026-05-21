import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM properties ORDER BY created_at DESC'
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
    console.log('Creating property:', body);
    
    const id = crypto.randomUUID();
    
    await env.DB.prepare(
      `INSERT INTO properties (id, name, address, city, state, zip_code, type, description, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.name,
      body.address,
      body.city,
      body.state,
      body.zipCode,
      body.type,
      body.description || null,
      body.userId || 'system'
    ).run();
    
    console.log('Property created successfully:', id);
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    console.error('Error creating property:', error);
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
