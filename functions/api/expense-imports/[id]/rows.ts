import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { normalizeCategory, parseDate, parseAmount, duplicateKey } from '../../../lib/expense-import';

interface RowUpdate {
  id: string;
  propertyId?: string;
  unitId?: string;
  category?: string;
  amount?: number | string;
  date?: string;
  description?: string;
  vendor?: string;
  notes?: string;
  taxCategory?: string;
  taxDeductible?: boolean;
  status?: 'skipped'; // only allow skipping manually
}

/**
 * PUT /api/expense-imports/:id/rows — edit staged rows (single or bulk).
 * Body: { rows: RowUpdate[] }
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_import');
  if (auth instanceof Response) return auth;

  try {
    const importId = params.id as string;
    const imp = await env.DB.prepare(
      'SELECT status FROM expense_imports WHERE id = ?'
    ).bind(importId).first<{ status: string }>();
    if (!imp) return jsonError('Import not found', 404);
    if (imp.status === 'merged') return jsonError('Cannot edit a merged import.', 400);

    const body = (await request.json()) as { rows: RowUpdate[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return jsonError('Provide at least one row to update.', 400);
    }

    // Load reference data for re-validation
    const [propRows, unitRows, existingExpenses] = await Promise.all([
      env.DB.prepare('SELECT id, name FROM properties').all(),
      env.DB.prepare('SELECT id, property_id, unit_number FROM units').all(),
      env.DB.prepare('SELECT property_id, date, amount, description FROM expenses').all(),
    ]);

    const propertyIds = new Set((propRows.results || []).map(p => p.id as string));
    const unitMap = new Map<string, string>(); // unitId → propertyId
    for (const u of (unitRows.results || [])) {
      unitMap.set(u.id as string, u.property_id as string);
    }
    const existingKeys = new Set<string>();
    for (const e of (existingExpenses.results || [])) {
      const k = duplicateKey({
        propertyId: e.property_id as string,
        date: e.date as string,
        amount: e.amount as number,
        description: e.description as string,
      });
      if (k) existingKeys.add(k);
    }

    const stmts: ReturnType<typeof env.DB.prepare>[] = [];
    let updatedCount = 0;

    for (const update of body.rows) {
      if (!update.id) continue;

      // If user wants to skip this row
      if (update.status === 'skipped') {
        stmts.push(
          env.DB.prepare(
            `UPDATE expense_import_rows SET status = 'skipped', edited = 1, edited_by = ?, edited_at = unixepoch() WHERE id = ? AND import_id = ?`
          ).bind(auth.id, update.id, importId)
        );
        updatedCount++;
        continue;
      }

      const sets: string[] = [];
      const binds: unknown[] = [];

      if (update.propertyId !== undefined) {
        if (update.propertyId && !propertyIds.has(update.propertyId)) {
          return jsonError(`Invalid property ID: ${update.propertyId}`, 400);
        }
        sets.push('property_id = ?');
        binds.push(update.propertyId || null);
      }
      if (update.unitId !== undefined) {
        sets.push('unit_id = ?');
        binds.push(update.unitId || null);
      }
      if (update.category !== undefined) {
        const normalized = normalizeCategory(update.category) || update.category;
        sets.push('category = ?');
        binds.push(normalized || null);
      }
      if (update.amount !== undefined) {
        const parsed = typeof update.amount === 'number' ? update.amount : parseAmount(String(update.amount));
        sets.push('amount = ?');
        binds.push(parsed ?? null);
      }
      if (update.date !== undefined) {
        const parsed = parseDate(update.date) || update.date;
        sets.push('date = ?');
        binds.push(parsed || null);
      }
      if (update.description !== undefined) {
        sets.push('description = ?');
        binds.push(update.description || null);
      }
      if (update.vendor !== undefined) {
        sets.push('vendor = ?');
        binds.push(update.vendor || null);
      }
      if (update.notes !== undefined) {
        sets.push('notes = ?');
        binds.push(update.notes || null);
      }
      if (update.taxCategory !== undefined) {
        sets.push('tax_category = ?');
        binds.push(update.taxCategory || null);
      }
      if (update.taxDeductible !== undefined) {
        sets.push('tax_deductible = ?');
        binds.push(update.taxDeductible ? 1 : 0);
      }

      if (sets.length === 0) continue;

      sets.push('edited = 1', 'edited_by = ?', 'edited_at = unixepoch()');
      binds.push(auth.id);
      binds.push(update.id, importId);

      stmts.push(
        env.DB.prepare(
          `UPDATE expense_import_rows SET ${sets.join(', ')} WHERE id = ? AND import_id = ?`
        ).bind(...binds)
      );
      updatedCount++;
    }

    if (stmts.length > 0) await env.DB.batch(stmts);

    // Re-validate all non-skipped rows
    await revalidateImport(env, importId, propertyIds, unitMap, existingKeys);

    return jsonOk({ success: true, updatedCount });
  } catch (err) {
    console.error('Row update error:', err);
    return serverError();
  }
};

/** Re-run validation on all non-skipped rows and update import counters. */
async function revalidateImport(
  env: Env['DB'] extends infer DB ? { DB: DB } : never,
  importId: string,
  propertyIds: Set<string>,
  unitMap: Map<string, string>,
  existingKeys: Set<string>,
) {
  const { results: rows } = await env.DB.prepare(
    `SELECT * FROM expense_import_rows WHERE import_id = ? AND status != 'skipped' ORDER BY row_number`
  ).bind(importId).all();
  if (!rows) return;

  const withinKeys = new Map<string, number>();
  let valid = 0, errors = 0, dups = 0;
  const stmts: ReturnType<typeof env.DB.prepare>[] = [];

  for (const row of rows) {
    const errs: { field: string; message: string }[] = [];
    const amount = row.amount as number | null;
    const date = row.date as string | null;
    const description = row.description as string | null;
    const category = row.category as string | null;
    const propertyId = row.property_id as string | null;
    const unitId = row.unit_id as string | null;

    if (amount == null || amount <= 0) errs.push({ field: 'amount', message: 'Amount is missing or invalid' });
    if (!date) errs.push({ field: 'date', message: 'Date is missing' });
    if (!description) errs.push({ field: 'description', message: 'Description is missing' });
    if (!category) errs.push({ field: 'category', message: 'Category is missing' });
    if (!propertyId) errs.push({ field: 'property', message: 'Property is missing' });
    else if (!propertyIds.has(propertyId)) errs.push({ field: 'property', message: 'Property not found' });
    if (unitId && !unitMap.has(unitId)) errs.push({ field: 'unit', message: 'Unit not found' });

    let isDup = false;
    const dk = duplicateKey({ propertyId: propertyId ?? undefined, date: date ?? undefined, amount: amount ?? undefined, description: description ?? undefined });
    if (dk) {
      if (existingKeys.has(dk)) {
        errs.push({ field: 'duplicate', message: 'Matching expense already exists' });
        isDup = true;
      } else if (withinKeys.has(dk)) {
        errs.push({ field: 'duplicate', message: `Duplicate of row ${withinKeys.get(dk)!}` });
        isDup = true;
      } else {
        withinKeys.set(dk, row.row_number as number);
      }
    }

    let status: string;
    if (isDup) { status = 'duplicate'; dups++; }
    else if (errs.length > 0) { status = 'error'; errors++; }
    else { status = 'valid'; valid++; }

    stmts.push(
      env.DB.prepare(
        `UPDATE expense_import_rows SET status = ?, errors = ? WHERE id = ?`
      ).bind(status, errs.length > 0 ? JSON.stringify(errs) : null, row.id as string)
    );
  }

  // Count skipped rows
  const skipped = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM expense_import_rows WHERE import_id = ? AND status = 'skipped'`
  ).bind(importId).first<{ cnt: number }>();

  const total = valid + errors + dups + (skipped?.cnt || 0);

  stmts.push(
    env.DB.prepare(
      `UPDATE expense_imports SET status = 'validated', total_rows = ?, valid_rows = ?, error_rows = ?, duplicate_rows = ? WHERE id = ?`
    ).bind(total, valid, errors, dups, importId)
  );

  if (stmts.length > 0) await env.DB.batch(stmts);
}
