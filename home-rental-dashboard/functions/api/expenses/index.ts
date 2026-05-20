import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM expenses ORDER BY created_at DESC'
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
      `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, recurring_frequency, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.propertyId || null,
      body.unitId || null,
      body.category,
      body.amount,
      body.date,
      body.description,
      body.vendor || null,
      body.isRecurring ? 1 : 0,
      body.recurringFrequency || null,
      body.userId || 'system'
    ).run();
    
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
