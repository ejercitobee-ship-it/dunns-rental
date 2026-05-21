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
  console.log('Properties POST handler invoked');
  
  try {
    const { env, request } = context;
    
    console.log('Parsing request body...');
    const body = await request.json();
    console.log('Request body:', JSON.stringify(body));
    
    console.log('Generating UUID...');
    const id = crypto.randomUUID();
    console.log('Generated ID:', id);
    
    console.log('Preparing database query...');
    const query = `INSERT INTO properties (id, name, address, city, state, zip_code, type, description, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    console.log('Query:', query);
    
    const params = [
      id,
      body.name,
      body.address,
      body.city,
      body.state,
      body.zipCode,
      body.type,
      body.description || null,
      body.userId || 'system'
    ];
    console.log('Params:', JSON.stringify(params));
    
    console.log('Executing database query...');
    await env.DB.prepare(query).bind(...params).run();
    
    console.log('Property created successfully:', id);
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    console.error('Error in properties POST handler:', error);
    console.error('Error message:', (error as Error).message);
    console.error('Error stack:', (error as Error).stack);
    return Response.json({ 
      success: false, 
      error: (error as Error).message,
      stack: (error as Error).stack 
    }, { status: 500 });
  }
};
