import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { parseCSV, mapColumns, buildStagedRow, validateRow, duplicateKey } from '../../lib/expense-import';

/** GET /api/expense-imports — list all imports, newest first. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_import');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM expense_imports ORDER BY uploaded_at DESC`
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeImport) });
  } catch { return serverError(); }
};

/**
 * POST /api/expense-imports — upload a CSV file, parse it into staged rows,
 * run initial validation, and store everything. The file body is multipart
 * form data with a single "file" field.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_import');
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as unknown as { name: string; text(): Promise<string> } | null;
    if (!file) return jsonError('No file uploaded.', 400);

    const fileName = file.name || 'import.csv';
    const text = await file.text();
    if (!text.trim()) return jsonError('The file is empty.', 400);

    const parsed = parseCSV(text);
    if (parsed.length < 2) return jsonError('The file must have a header row and at least one data row.', 400);

    const headers = parsed[0];
    const colMap = mapColumns(headers);

    // Check that we found at least date + amount
    const mappedFields = new Set(Object.values(colMap));
    if (!mappedFields.has('date') || !mappedFields.has('amount')) {
      return jsonError(
        `Could not detect required columns. Found: ${[...mappedFields].join(', ') || 'none'}. ` +
        `Make sure the CSV has headers like Date, Amount, Category, Property, Description.`,
        400,
      );
    }

    // Load reference data for validation
    const [propRows, unitRows, existingExpenses] = await Promise.all([
      env.DB.prepare('SELECT id, name FROM properties').all(),
      env.DB.prepare('SELECT id, property_id, unit_number FROM units').all(),
      env.DB.prepare('SELECT property_id, date, amount, description FROM expenses').all(),
    ]);

    const propertyNames = new Map<string, string>();
    for (const p of (propRows.results || [])) {
      propertyNames.set((p.name as string).trim().toLowerCase(), p.id as string);
    }

    const unitsByProperty = new Map<string, Map<string, string>>();
    for (const u of (unitRows.results || [])) {
      const pid = u.property_id as string;
      if (!unitsByProperty.has(pid)) unitsByProperty.set(pid, new Map());
      unitsByProperty.get(pid)!.set((u.unit_number as string).trim().toLowerCase(), u.id as string);
    }

    // Existing expense keys for cross-duplicate detection
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

    // Parse rows
    const importId = crypto.randomUUID();
    const dataRows = parsed.slice(1);
    const stagedInserts: { stmt: string; binds: unknown[] }[] = [];
    const withinImportKeys = new Map<string, number>(); // key → first row number
    let validCount = 0;
    let errorCount = 0;
    let dupCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const cells = dataRows[i];
      // Skip completely empty rows
      if (cells.every(c => !c.trim())) continue;

      const staged = buildStagedRow(cells, headers, colMap);
      const { errors, propertyId, unitId } = validateRow(staged, propertyNames, unitsByProperty);

      const rowId = crypto.randomUUID();
      const resolvedPropertyId = propertyId ?? null;
      const resolvedUnitId = unitId ?? null;

      // Duplicate check
      let isDuplicate = false;
      const dk = duplicateKey({
        propertyId: resolvedPropertyId ?? undefined,
        date: staged.date,
        amount: staged.amount,
        description: staged.description,
      });

      if (dk) {
        if (existingKeys.has(dk)) {
          errors.push({ field: 'duplicate', message: 'A matching expense already exists in the system' });
          isDuplicate = true;
        } else if (withinImportKeys.has(dk)) {
          errors.push({ field: 'duplicate', message: `Duplicate of row ${withinImportKeys.get(dk)! + 1} in this import` });
          isDuplicate = true;
        } else {
          withinImportKeys.set(dk, i);
        }
      }

      let status: string;
      if (isDuplicate) { status = 'duplicate'; dupCount++; }
      else if (errors.length > 0) { status = 'error'; errorCount++; }
      else { status = 'valid'; validCount++; }

      stagedInserts.push({
        stmt: `INSERT INTO expense_import_rows
          (id, import_id, row_number, original_data, property_id, property_name, unit_id, unit_name,
           category, amount, date, description, vendor, notes, tax_category, tax_deductible,
           is_recurring, recurring_frequency, interest_amount, status, errors)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        binds: [
          rowId, importId, i + 1,
          JSON.stringify(staged.originalData),
          resolvedPropertyId, staged.propertyName ?? null,
          resolvedUnitId, staged.unitName ?? null,
          staged.category ?? null,
          staged.amount ?? null,
          staged.date ?? null,
          staged.description ?? null,
          staged.vendor ?? null,
          staged.notes ?? null,
          staged.taxCategory ?? null,
          1, // tax_deductible default
          staged.isRecurring ? 1 : 0,
          null, // recurring_frequency
          null, // interest_amount
          status,
          errors.length > 0 ? JSON.stringify(errors) : null,
        ],
      });
    }

    if (stagedInserts.length === 0) return jsonError('No data rows found in the file.', 400);

    // Batch insert: import header + all rows
    const stmts = [
      env.DB.prepare(
        `INSERT INTO expense_imports (id, file_name, uploaded_by, uploaded_by_name, total_rows, valid_rows, error_rows, duplicate_rows)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(importId, fileName, auth.id, auth.name, stagedInserts.length, validCount, errorCount, dupCount),
      ...stagedInserts.map(s => env.DB.prepare(s.stmt).bind(...s.binds)),
    ];

    await env.DB.batch(stmts);

    return jsonOk({
      success: true,
      data: {
        id: importId,
        fileName,
        totalRows: stagedInserts.length,
        validRows: validCount,
        errorRows: errorCount,
        duplicateRows: dupCount,
        columnMapping: Object.fromEntries(
          Object.entries(colMap).map(([idx, field]) => [headers[Number(idx)], field]),
        ),
      },
    }, 201);
  } catch (err) {
    console.error('Expense import error:', err);
    return serverError();
  }
};

// ---------------------------------------------------------------------------

function serializeImport(r: Record<string, unknown>) {
  return {
    id: r.id,
    fileName: r.file_name,
    fileDriveId: r.file_drive_id ?? undefined,
    uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name,
    uploadedAt: r.uploaded_at,
    status: r.status,
    totalRows: r.total_rows,
    validRows: r.valid_rows,
    errorRows: r.error_rows,
    duplicateRows: r.duplicate_rows,
    mergedRows: r.merged_rows,
    mergedAt: r.merged_at ?? undefined,
    mergedBy: r.merged_by ?? undefined,
    mergedByName: r.merged_by_name ?? undefined,
    rolledBackAt: r.rolled_back_at ?? undefined,
    rolledBackBy: r.rolled_back_by ?? undefined,
    rolledBackByName: r.rolled_back_by_name ?? undefined,
    notes: r.notes ?? undefined,
  };
}
