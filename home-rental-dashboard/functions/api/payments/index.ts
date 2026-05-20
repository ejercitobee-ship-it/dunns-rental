import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM rent_payments ORDER BY created_at DESC'
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
      `INSERT INTO rent_payments (id, tenant_id, unit_id, property_id, amount, due_date, paid_date, received_date, status, month, year, payment_method, uploaded_by, uploaded_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.tenantId || null,
      body.unitId || null,
      body.propertyId || null,
      body.amount,
      body.dueDate || null,
      body.paidDate || null,
      body.receivedDate || null,
      body.status || 'pending',
      body.month || null,
      body.year || null,
      body.paymentMethod || null,
      body.uploadedBy || null,
      body.uploadedAt || null,
      body.notes || null
    ).run();
    
    return Response.json({ success: true, data: { id, ...body } }, { status: 201 });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
