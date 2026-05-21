import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM properties WHERE id = ?'
    ).bind(id).first();
    
    if (!result) {
      return Response.json({ success: false, error: 'Property not found' }, { status: 404 });
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
      `UPDATE properties SET
        name = ?, address = ?, city = ?, state = ?, zip_code = ?, type = ?, description = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      body.name,
      body.address,
      body.city,
      body.state,
      body.zipCode,
      body.type,
      body.description || null,
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
    await env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(id).run();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
