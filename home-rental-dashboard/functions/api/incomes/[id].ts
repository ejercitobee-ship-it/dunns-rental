import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM incomes WHERE id = ?'
    ).bind(id).first();
    
    if (!result) {
      return Response.json({ success: false, error: 'Income not found' }, { status: 404 });
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
      `UPDATE incomes SET
        property_id = ?, unit_id = ?, source = ?, amount = ?, date = ?, description = ?, related_payment_id = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      body.propertyId || null,
      body.unitId || null,
      body.source,
      body.amount,
      body.date,
      body.description,
      body.relatedPaymentId || null,
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
    await env.DB.prepare('DELETE FROM incomes WHERE id = ?').bind(id).run();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
