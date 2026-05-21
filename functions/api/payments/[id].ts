import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM rent_payments WHERE id = ?'
    ).bind(id).first();
    
    if (!result) {
      return Response.json({ success: false, error: 'Payment not found' }, { status: 404 });
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
      `UPDATE rent_payments SET
        tenant_id = ?, unit_id = ?, property_id = ?, amount = ?, due_date = ?, paid_date = ?, received_date = ?,
        status = ?, month = ?, year = ?, payment_method = ?, uploaded_by = ?, uploaded_at = ?, notes = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
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
    await env.DB.prepare('DELETE FROM rent_payments WHERE id = ?').bind(id).run();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
