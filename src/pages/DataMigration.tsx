import { useState, useCallback, useRef } from 'react';
import {
  Upload, Download, FileText, AlertCircle, CheckCircle,
  X, Home, Users, DollarSign, Receipt, Building2,
  ArrowRight, Database, KeyRound,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type { Property, Unit, Tenant, RentPayment, Expense, LeaseStatus } from '../types';

/** A lease row as read from the CSV, before its ids are mapped to real,
 * server assigned ids. unitId, propertyId and tenantIds all still point at
 * the CSV's own local ids at this stage. */
interface ParsedLease {
  id: string;
  unitId?: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  monthlyRent: number;
  securityDeposit?: number;
  status: LeaseStatus;
  /** The day collection was paused. Required when status is 'paused': with
   * no pausedAt, leasesOwingMonth treats the lease as owing nothing at all
   * rather than guessing a stop date and inventing rent. Not a field on the
   * created lease itself: the leases POST reads it separately and opens an
   * OPEN lease_pauses interval (no resumedAt), since a CSV row has no way to
   * say a pause has already ended. */
  pausedAt?: string;
  notes?: string;
  tenantIds: string[];
}

/** A rent payment row as read from the CSV. leaseId and paidByTenantId still
 * point at CSV local ids until the import step maps them to real ones. */
interface ParsedRentPayment {
  id: string;
  leaseId: string;
  paidByTenantId?: string;
  amount: number;
  dueDate?: string;
  paidDate?: string;
  status: RentPayment['status'];
  month: number;
  year: number;
  notes?: string;
}

interface ParsedData {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  leases: ParsedLease[];
  rentPayments: ParsedRentPayment[];
  expenses: Expense[];
}

interface ValidationError {
  row: number;
  sheet: string;
  message: string;
  data?: string;
}

// Tenants carry only who a person is. Rent, dates and the unit all live on
// the lease, and tenantIds is pipe separated so several people can share one
// lease: this is what lets an import express "two adults, one lease, one
// rent" instead of billing the same rent once per person.
const SAMPLE_CSV = `=== PROPERTIES ===
id,name,address,city,state,zipCode,type,description
1,123 Main St,123 Main Street,Los Angeles,CA,90001,house,Single family home
2,456 Oak Ave,456 Oak Avenue,Santa Monica,CA,90401,apartment,Apartment building

=== UNITS ===
id,propertyId,unitNumber,bedrooms,bathrooms,squareFeet,monthlyRent,status
u1,1,A,3,2,1500,2500,occupied
u2,2,101,2,1,900,1800,vacant
u3,2,102,1,1,650,1400,vacant

=== TENANTS ===
id,firstName,lastName,email,phone
1,John,Doe,john@email.com,(555) 123-4567
2,Jane,Doe,jane@email.com,(555) 987-6543

=== LEASES ===
id,unitId,propertyId,startDate,endDate,monthlyRent,securityDeposit,status,pausedAt,tenantIds
L1,u1,1,2024-01-01,2024-12-31,2500,5000,active,,1|2

=== RENT_PAYMENTS ===
id,leaseId,paidByTenantId,amount,dueDate,paidDate,status,month,year
1,L1,1,2500,2024-01-01,2024-01-01,paid,1,2024

=== EXPENSES ===
id,propertyId,unitId,category,amount,date,description,vendor,isRecurring
1,1,,utilities,150,2024-01-15,Electric bill,Power Co,false
2,1,u1,repairs,200,2024-02-10,Plumbing fix,Plumber Pro,false
3,2,,insurance,300,2024-01-01,Property insurance,Insurance Co,true`;

function sheetLabel(sheet: string): string {
  return sheet.replace(/_/g, ' ');
}

const LEASE_STATUS_VALUES: LeaseStatus[] = ['active', 'paused', 'ended'];
// 'overdue' and 'partial' are derived by settleMonth from the amounts
// actually paid, never accepted as an input: a payment row IS or ISN'T
// money received, there is nothing else to import.
const PAYMENT_STATUS_VALUES: RentPayment['status'][] = ['paid', 'pending'];

export function DataMigration() {
  const { addProperty, addUnit, addTenant, addLease, addRentPayment, addExpense, refreshData } = useApp();
  const { showToast } = useToast();
  const [csvData, setCsvData] = useState('');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'properties' | 'units' | 'tenants' | 'leases' | 'rents' | 'expenses'>('all');

  // Synchronous re-entry guard: importing (state) only disables the button
  // after a render, so a fast double click could start a second overlapping
  // import before that render lands and create duplicate records.
  const isImportingRef = useRef(false);

  // CSV local id to real, server assigned id. Every entity gets a fresh id
  // from the API regardless of what the CSV said, so leases (which need a
  // real unitId and real tenantIds) and payments (which need a real
  // leaseId) cannot use the CSV ids directly. These maps carry that
  // translation, and they also double as the partial failure guard: they
  // persist across a retry, so a row whose id is already mapped is skipped
  // rather than recreated. Payments and expenses have nothing depending on
  // their id afterward, so a plain "already imported" set is enough for them.
  const propertyIdMapRef = useRef(new Map<string, string>());
  const unitIdMapRef = useRef(new Map<string, string>());
  const tenantIdMapRef = useRef(new Map<string, string>());
  const leaseIdMapRef = useRef(new Map<string, string>());
  const importedPaymentIdsRef = useRef(new Set<string>());
  const importedExpenseIdsRef = useRef(new Set<string>());

  const resetImportProgress = () => {
    propertyIdMapRef.current.clear();
    unitIdMapRef.current.clear();
    tenantIdMapRef.current.clear();
    leaseIdMapRef.current.clear();
    importedPaymentIdsRef.current.clear();
    importedExpenseIdsRef.current.clear();
  };

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migration-template.csv';
    a.click();
  };

  const parseCSV = useCallback((csv: string): { data: ParsedData; errors: ValidationError[] } => {
    const lines = csv.trim().split('\n');
    const data: ParsedData = {
      properties: [],
      units: [],
      tenants: [],
      leases: [],
      rentPayments: [],
      expenses: [],
    };
    const errors: ValidationError[] = [];

    let currentSection = '';
    let rowNum = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Detect section headers
      if (line.startsWith('===')) {
        currentSection = line.replace(/===/g, '').trim().toLowerCase().replace(/\s+/g, '_');
        rowNum = 0;
        continue;
      }

      // Skip header rows
      if (line.startsWith('id,')) {
        rowNum = 0;
        continue;
      }

      rowNum++;
      const cols = line.split(',').map(c => c.trim());

      try {
        switch (currentSection) {
          case 'properties':
            if (cols.length >= 6) {
              data.properties.push({
                id: cols[0],
                name: cols[1],
                address: cols[2],
                city: cols[3],
                state: cols[4],
                zipCode: cols[5],
                type: (cols[6] as Property['type']) || 'house',
                description: cols[7] || '',
              });
            }
            break;

          case 'units':
            if (cols.length >= 7) {
              data.units.push({
                id: cols[0],
                propertyId: cols[1],
                unitNumber: cols[2],
                bedrooms: parseInt(cols[3]) || 0,
                bathrooms: parseFloat(cols[4]) || 0,
                squareFeet: parseInt(cols[5]) || 0,
                monthlyRent: parseFloat(cols[6]) || 0,
                status: (cols[7] as Unit['status']) || 'vacant',
                description: cols[8] || '',
              });
            }
            break;

          case 'tenants':
            // A person only: firstName and lastName are the only required
            // fields. Rent, dates and the unit belong to a lease, not to a
            // person, under this model.
            if (cols.length >= 3) {
              data.tenants.push({
                id: cols[0],
                firstName: cols[1],
                lastName: cols[2],
                email: cols[3] || undefined,
                phone: cols[4] || undefined,
                notes: cols[5] || undefined,
              });
            }
            break;

          case 'leases': {
            // A LEASES row now carries pausedAt, so an older 9 column file
            // would silently import zero leases and still report success.
            // Say so instead.
            if (cols.length > 0 && cols.length < 10) {
              errors.push({
                row: rowNum,
                sheet: currentSection,
                message:
                  'A lease row needs 10 columns. Add the pausedAt column, blank unless rent is paused.',
                data: line,
              });
            }
            if (cols.length >= 10) {
              const unitId = cols[1] || undefined;
              const endDate = cols[4] || undefined;
              const pausedAt = cols[8] || undefined;
              const tenantIds = (cols[9] || '').split('|').map(t => t.trim()).filter(Boolean);

              // A lease can outlive its unit (the column is cleared if the unit
              // is deleted), but it cannot be created without one: the API
              // rejects that with a 400. Catch it here so the row is reported
              // alongside the others rather than failing mid import.
              if (!unitId) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: 'A lease needs a unitId. Name the unit this tenancy is on.',
                  data: line,
                });
              } else if (!data.units.some(u => u.id === unitId)) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: `Unit "${unitId}" was not found in the UNITS section.`,
                  data: line,
                });
              }

              const missingTenantIds = tenantIds.filter(tid => !data.tenants.some(t => t.id === tid));
              if (missingTenantIds.length > 0) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: `Tenant id(s) ${missingTenantIds.join(', ')} were not found in the TENANTS section.`,
                  data: line,
                });
              }

              // A raw cast here (`cols[7] as LeaseStatus`) would let a
              // misspelled or wrongly cased cell like "Active" through as a
              // typed LeaseStatus that isn't actually one of the three
              // values: activeLeases would then miss the lease (0 revenue,
              // no rent rows) while getUnitLease still matched it, leaving
              // the unit both unbillable and blocked from a new tenancy,
              // with no error surfaced anywhere. Validate it here instead.
              const rawLeaseStatus = (cols[7] || '').trim().toLowerCase();
              let status: LeaseStatus = 'active';
              if (rawLeaseStatus && !LEASE_STATUS_VALUES.includes(rawLeaseStatus as LeaseStatus)) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: `Status "${cols[7]}" is not valid. Use active, paused or ended.`,
                  data: line,
                });
              } else if (rawLeaseStatus) {
                status = rawLeaseStatus as LeaseStatus;
              }

              // A paused lease with no pausedAt has no known stop date:
              // leasesOwingMonth reads that as owing nothing at all rather
              // than guess one, which silently erases every month of rent
              // from the current date backward. Catch the bad row instead.
              if (status === 'paused' && !pausedAt) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: 'A paused lease needs a pausedAt date. Without one, no rent can be billed for it at all.',
                  data: line,
                });
              }

              // An ended lease with no endDate has no known upper bound:
              // leaseCoversMonth would then see the lease as covering every
              // month forever, billing a tenant who moved out years ago.
              if (status === 'ended' && !endDate) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: 'An ended lease needs an endDate. Without one, the lease would be billed forever.',
                  data: line,
                });
              }

              data.leases.push({
                id: cols[0],
                unitId,
                propertyId: cols[2] || undefined,
                startDate: cols[3] || undefined,
                endDate,
                monthlyRent: parseFloat(cols[5]) || 0,
                securityDeposit: cols[6] ? (parseFloat(cols[6]) || 0) : undefined,
                status,
                pausedAt,
                tenantIds,
              });
            }
            break;
          }

          case 'rent_payments': {
            if (cols.length >= 9) {
              const leaseId = cols[1] || '';

              // The payments API requires leaseId and returns 400 without
              // it, so an empty or unknown leaseId has to be caught here,
              // before import, rather than surfacing as a failed request.
              if (!leaseId) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: 'A leaseId is required for every rent payment.',
                  data: line,
                });
              } else if (!data.leases.some(l => l.id === leaseId)) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: `Lease "${leaseId}" was not found in the LEASES section.`,
                  data: line,
                });
              }

              // Only status === 'paid' counts as money received anywhere in
              // the app now, so an unvalidated cell here (a typo, a stray
              // space) would silently import a payment that never counts as
              // collected instead of failing loudly. 'overdue' and 'partial'
              // are derived by settleMonth from the amounts paid, not valid
              // inputs: they are rejected here rather than silently accepted
              // and then ignored by every money calculation in the app.
              const rawPaymentStatus = (cols[6] || '').trim().toLowerCase();
              let status: RentPayment['status'] = 'pending';
              if (rawPaymentStatus && !PAYMENT_STATUS_VALUES.includes(rawPaymentStatus as RentPayment['status'])) {
                errors.push({
                  row: rowNum,
                  sheet: currentSection,
                  message: `Status "${cols[6]}" is not valid. Use paid or pending.`,
                  data: line,
                });
              } else if (rawPaymentStatus) {
                status = rawPaymentStatus as RentPayment['status'];
              }

              data.rentPayments.push({
                id: cols[0],
                leaseId,
                paidByTenantId: cols[2] || undefined,
                amount: parseFloat(cols[3]) || 0,
                dueDate: cols[4] || undefined,
                paidDate: cols[5] || undefined,
                status,
                month: parseInt(cols[7]) || 1,
                year: parseInt(cols[8]) || new Date().getFullYear(),
              });
            }
            break;
          }

          case 'expenses':
            if (cols.length >= 7) {
              data.expenses.push({
                id: cols[0],
                propertyId: cols[1],
                unitId: cols[2] || undefined,
                category: (cols[3] as Expense['category']) || 'other',
                amount: parseFloat(cols[4]) || 0,
                date: cols[5],
                description: cols[6],
                vendor: cols[7] || undefined,
                isRecurring: cols[8]?.toLowerCase() === 'true' || false,
                recurringFrequency: (cols[9] as 'monthly' | 'quarterly' | 'yearly') || undefined,
              });
            }
            break;
        }
      } catch (err) {
        errors.push({
          row: rowNum,
          sheet: currentSection,
          message: `Failed to parse row: ${err}`,
          data: line,
        });
      }
    }

    return { data, errors };
  }, []);

  const handleValidate = () => {
    if (!csvData.trim()) {
      showToast('Please paste CSV data first.', 'error');
      return;
    }

    const { data, errors } = parseCSV(csvData);
    // A fresh validate means a fresh import: forget any id mappings left
    // over from a previous, unrelated paste so they cannot leak into this one.
    resetImportProgress();
    setParsedData(data);
    setErrors(errors);
    setShowPreview(true);
    setActiveTab('all');

    if (errors.length === 0) {
      showToast(
        `Found ${data.properties.length} properties, ${data.units.length} units, ${data.tenants.length} tenants, ${data.leases.length} leases, ${data.rentPayments.length} payments, ${data.expenses.length} expenses.`,
        'success'
      );
    }
  };

  const handleImport = async () => {
    // Bail out synchronously if a submit is already in flight, so a fast
    // double click cannot start two overlapping import loops.
    if (isImportingRef.current || !parsedData) return;

    isImportingRef.current = true;
    setImporting(true);
    let imported = 0;

    try {
      // 1. Properties. Skip any CSV id already mapped from an earlier,
      // partially failed attempt, so retrying never creates a duplicate.
      for (const property of parsedData.properties) {
        if (propertyIdMapRef.current.has(property.id)) continue;
        const created = await addProperty({
          name: property.name,
          address: property.address,
          city: property.city,
          state: property.state,
          zipCode: property.zipCode,
          type: property.type,
          description: property.description,
          purchaseDate: property.purchaseDate,
          purchasePrice: property.purchasePrice,
        });
        propertyIdMapRef.current.set(property.id, created.id);
        imported++;
      }

      // 2. Units. Needs each unit's real propertyId, from the map just built.
      for (const unit of parsedData.units) {
        if (unitIdMapRef.current.has(unit.id)) continue;
        const created = await addUnit({
          propertyId: propertyIdMapRef.current.get(unit.propertyId) || unit.propertyId,
          unitNumber: unit.unitNumber,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          squareFeet: unit.squareFeet,
          monthlyRent: unit.monthlyRent,
          status: unit.status,
          description: unit.description,
        });
        unitIdMapRef.current.set(unit.id, created.id);
        imported++;
      }

      // 3. Tenants: people only, no unit or rent on them.
      for (const tenant of parsedData.tenants) {
        if (tenantIdMapRef.current.has(tenant.id)) continue;
        const created = await addTenant({
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          email: tenant.email,
          phone: tenant.phone,
          notes: tenant.notes,
        });
        tenantIdMapRef.current.set(tenant.id, created.id);
        imported++;
      }

      // 4. Leases: need the real unit and tenant ids mapped above. The
      // leases API itself checks that every tenantId exists and writes the
      // lease and its occupant links atomically, but the validation pass in
      // parseCSV already rejected any CSV row naming an id that never
      // appeared in TENANTS or UNITS, so this should not hit that 400 in
      // the normal case.
      for (const lease of parsedData.leases) {
        if (leaseIdMapRef.current.has(lease.id)) continue;
        const tenantIds = lease.tenantIds
          .map(tid => tenantIdMapRef.current.get(tid))
          .filter((id): id is string => !!id);
        const created = await addLease({
          unitId: lease.unitId ? unitIdMapRef.current.get(lease.unitId) : undefined,
          propertyId: lease.propertyId ? propertyIdMapRef.current.get(lease.propertyId) : undefined,
          startDate: lease.startDate,
          endDate: lease.endDate,
          monthlyRent: lease.monthlyRent,
          securityDeposit: lease.securityDeposit,
          status: lease.status,
          // Not part of the Lease shape itself: the leases POST reads this
          // separately and, when present, opens an OPEN lease_pauses interval
          // (no resumedAt), since a CSV row has no way to say a pause has
          // already ended.
          pausedAt: lease.pausedAt,
          notes: lease.notes,
          tenantIds,
          pauses: [],
        });
        leaseIdMapRef.current.set(lease.id, created.id);
        imported++;
      }

      // 5. Rent payments: need the real leaseId. A row whose leaseId never
      // maps (validation should already have blocked this) is skipped
      // rather than sent to an API that requires leaseId and amount.
      for (const payment of parsedData.rentPayments) {
        if (importedPaymentIdsRef.current.has(payment.id)) continue;
        const realLeaseId = leaseIdMapRef.current.get(payment.leaseId);
        if (!realLeaseId) continue;
        await addRentPayment({
          leaseId: realLeaseId,
          paidByTenantId: payment.paidByTenantId ? tenantIdMapRef.current.get(payment.paidByTenantId) : undefined,
          amount: payment.amount,
          dueDate: payment.dueDate,
          paidDate: payment.paidDate,
          receivedDate: payment.paidDate,
          status: payment.status,
          month: payment.month,
          year: payment.year,
          notes: payment.notes,
        });
        importedPaymentIdsRef.current.add(payment.id);
        imported++;
      }

      // 6. Expenses: attach to the real property and unit, when known.
      for (const expense of parsedData.expenses) {
        if (importedExpenseIdsRef.current.has(expense.id)) continue;
        await addExpense({
          propertyId: propertyIdMapRef.current.get(expense.propertyId) || expense.propertyId,
          unitId: expense.unitId ? (unitIdMapRef.current.get(expense.unitId) || expense.unitId) : undefined,
          category: expense.category,
          amount: expense.amount,
          date: expense.date,
          description: expense.description,
          vendor: expense.vendor,
          isRecurring: expense.isRecurring,
          recurringFrequency: expense.recurringFrequency,
        });
        importedExpenseIdsRef.current.add(expense.id);
        imported++;
      }

      await refreshData();
      showToast(`Successfully imported ${imported} records.`, 'success');
      setShowPreview(false);
      setCsvData('');
      setParsedData(null);
      resetImportProgress();
    } catch (err) {
      // Everything created above this point is already persisted server
      // side and stays mapped in the refs, so clicking Confirm Import again
      // resumes from here instead of recreating those records.
      showToast(`Import stopped partway through: ${(err as Error).message}. Records already created were kept. Fix the remaining rows and import again.`, 'error');
    } finally {
      isImportingRef.current = false;
      setImporting(false);
    }
  };

  const getTabCount = (tab: string) => {
    if (!parsedData) return 0;
    switch (tab) {
      case 'properties': return parsedData.properties.length;
      case 'units': return parsedData.units.length;
      case 'tenants': return parsedData.tenants.length;
      case 'leases': return parsedData.leases.length;
      case 'rents': return parsedData.rentPayments.length;
      case 'expenses': return parsedData.expenses.length;
      default: return parsedData.properties.length + parsedData.units.length + parsedData.tenants.length + parsedData.leases.length + parsedData.rentPayments.length + parsedData.expenses.length;
    }
  };

  const tenantName = (tenantId: string): string => {
    const t = parsedData?.tenants.find(t => t.id === tenantId);
    return t ? `${t.firstName} ${t.lastName}` : tenantId;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Data Migration</h1>
          <p className="text-muted mt-1 text-sm">Import properties, units, tenants, leases, rent and expenses in one go from a CSV file.</p>
        </div>
        <Button variant="outline" onClick={downloadTemplate} className="w-full sm:w-auto">
          <Download className="h-4 w-4 mr-2" />
          Download Template
        </Button>
      </div>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            How to Import
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">1</span>
                Download Template
              </div>
              <p className="text-sm text-muted">
                Get the sample CSV file with the correct format for every section.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">2</span>
                Fill Your Data
              </div>
              <p className="text-sm text-muted">
                Replace the sample rows with your own properties, units, tenants, leases, rent payments and expenses.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">3</span>
                Paste &amp; Import
              </div>
              <p className="text-sm text-muted">
                Paste your CSV data below, validate it, then import everything in one click.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CSV Format Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            CSV Format Guide
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-canvas rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium text-ink">Your CSV file should have sections separated by headers.</p>
              <code className="block bg-sidebar text-primary-soft px-4 py-3 rounded-lg text-xs font-mono overflow-x-auto">
                === PROPERTIES ===<br/>
                id,name,address,city,state,zipCode,type,description<br/>
                <br/>
                === UNITS ===<br/>
                id,propertyId,unitNumber,bedrooms,bathrooms,squareFeet,monthlyRent,status<br/>
                <br/>
                === TENANTS ===<br/>
                id,firstName,lastName,email,phone<br/>
                <br/>
                === LEASES ===<br/>
                id,unitId,propertyId,startDate,endDate,monthlyRent,securityDeposit,status,pausedAt,tenantIds<br/>
                <br/>
                === RENT_PAYMENTS ===<br/>
                id,leaseId,paidByTenantId,amount,dueDate,paidDate,status,month,year<br/>
                <br/>
                === EXPENSES ===<br/>
                id,propertyId,unitId,category,amount,date,description,vendor,isRecurring
              </code>
              <p className="text-sm text-muted flex items-start gap-2 pt-1">
                <KeyRound className="h-4 w-4 mt-0.5 flex-shrink-0" />
                A lease's tenantIds column holds one or more TENANTS ids, joined with a pipe, for example 1|2. That is how one lease covers two adults sharing a single rent.
              </p>
              <p className="text-sm text-muted flex items-start gap-2 pt-1">
                <Users className="h-4 w-4 mt-0.5 flex-shrink-0" />
                A paused lease requires a pausedAt date, and an ended lease requires an endDate. Without one, that lease cannot be billed correctly and the row is rejected.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <h4 className="font-semibold text-ink flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Property Types
                </h4>
                <p className="text-sm text-muted">house, apartment, condo, townhouse, multi family</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-ink flex items-center gap-2">
                  <Home className="h-4 w-4" /> Unit Status
                </h4>
                <p className="text-sm text-muted">occupied, vacant, maintenance</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-ink flex items-center gap-2">
                  <Users className="h-4 w-4" /> Lease Status
                </h4>
                <p className="text-sm text-muted">active, paused (requires pausedAt), ended (requires endDate)</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-ink flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Payment Status
                </h4>
                <p className="text-sm text-muted">paid, pending</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <h4 className="font-semibold text-ink flex items-center gap-2">
                  <Receipt className="h-4 w-4" /> Expense Categories
                </h4>
                <p className="text-sm text-muted">maintenance, utilities, insurance, taxes, mortgage, repairs, cleaning, landscaping, management, realtor_commission, other</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Paste Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Paste Your CSV Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            value={csvData}
            onChange={(e) => setCsvData(e.target.value)}
            rows={15}
            placeholder="Paste your CSV data here..."
            className="w-full px-4 py-3 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 font-mono text-sm"
          />

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCsvData('');
                setParsedData(null);
                setErrors([]);
                resetImportProgress();
              }}
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
            <Button onClick={handleValidate} disabled={!csvData.trim()}>
              <ArrowRight className="h-4 w-4 mr-2" />
              Validate &amp; Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <Modal
        isOpen={showPreview}
        onClose={importing ? () => {} : () => setShowPreview(false)}
        title="Import Preview"
        size="xl"
      >
        <div className="space-y-6">
          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-danger-soft border border-[#e8cdc8] rounded-lg p-4">
              <h4 className="font-semibold text-danger flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4" />
                Validation Errors ({errors.length})
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {errors.map((err, i) => (
                  <div key={i} className="text-sm text-danger">
                    Row {err.row} in {sheetLabel(err.sheet)}: {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Cards */}
          {parsedData && (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  { key: 'properties', label: 'Properties', icon: Building2, count: parsedData.properties.length },
                  { key: 'units', label: 'Units', icon: Home, count: parsedData.units.length },
                  { key: 'tenants', label: 'Tenants', icon: Users, count: parsedData.tenants.length },
                  { key: 'leases', label: 'Leases', icon: KeyRound, count: parsedData.leases.length },
                  { key: 'rents', label: 'Payments', icon: DollarSign, count: parsedData.rentPayments.length },
                  { key: 'expenses', label: 'Expenses', icon: Receipt, count: parsedData.expenses.length },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key as typeof activeTab)}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      activeTab === item.key
                        ? 'border-primary bg-primary/5'
                        : 'border-line hover:border-primary/50'
                    }`}
                  >
                    <item.icon className="h-5 w-5 mx-auto mb-1 text-faint" />
                    <div className="text-2xl font-semibold text-ink tnum">{item.count}</div>
                    <div className="text-xs text-muted">{item.label}</div>
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="border border-line rounded-lg overflow-hidden">
                <div className="bg-canvas px-4 py-2 border-b border-line flex items-center justify-between">
                  <span className="font-medium text-ink">
                    {activeTab === 'all' ? 'All Data' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                  </span>
                  <Badge>{getTabCount(activeTab)} records</Badge>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line bg-canvas">
                        {activeTab === 'properties' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Name</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Address</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">City</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Type</th>
                          </>
                        )}
                        {activeTab === 'units' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Unit</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Property</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Bed/Bath</th>
                            <th className="text-right py-2 px-3 text-sm font-medium text-ink">Rent</th>
                          </>
                        )}
                        {activeTab === 'tenants' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Name</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Email</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Phone</th>
                          </>
                        )}
                        {activeTab === 'leases' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Unit</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Tenants</th>
                            <th className="text-right py-2 px-3 text-sm font-medium text-ink">Rent</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Status</th>
                          </>
                        )}
                        {activeTab === 'rents' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Lease</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Paid By</th>
                            <th className="text-right py-2 px-3 text-sm font-medium text-ink">Amount</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Status</th>
                          </>
                        )}
                        {activeTab === 'expenses' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Category</th>
                            <th className="text-right py-2 px-3 text-sm font-medium text-ink">Amount</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Date</th>
                            <th className="text-left py-2 px-3 text-sm font-medium text-ink">Description</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {activeTab === 'all' && (
                        <>
                          {parsedData.properties.map((p, i) => (
                            <tr key={`p-${i}`} className="border-b border-line hover:bg-black/[0.02]">
                              <td className="py-2 px-3 text-sm text-ink" colSpan={4}>
                                <span className="font-medium">{p.name}</span>, {p.address}, {p.city}
                              </td>
                            </tr>
                          ))}
                          {parsedData.units.map((u, i) => (
                            <tr key={`u-${i}`} className="border-b border-line hover:bg-black/[0.02]">
                              <td className="py-2 px-3 text-sm text-ink" colSpan={4}>
                                Unit {u.unitNumber}, {u.bedrooms}bd/{u.bathrooms}ba, {formatCurrency(u.monthlyRent)}/mo
                              </td>
                            </tr>
                          ))}
                          {parsedData.tenants.map((t, i) => (
                            <tr key={`t-${i}`} className="border-b border-line hover:bg-black/[0.02]">
                              <td className="py-2 px-3 text-sm text-ink" colSpan={4}>
                                {t.firstName} {t.lastName}{t.email ? `, ${t.email}` : ''}
                              </td>
                            </tr>
                          ))}
                          {parsedData.leases.map((l, i) => (
                            <tr key={`l-${i}`} className="border-b border-line hover:bg-black/[0.02]">
                              <td className="py-2 px-3 text-sm text-ink" colSpan={4}>
                                Lease {l.id}, unit {l.unitId || '—'}, {formatCurrency(l.monthlyRent)}/mo, {l.tenantIds.map(tenantName).join(', ') || 'no tenants'}
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                      {activeTab === 'properties' && parsedData.properties.map((p, i) => (
                        <tr key={i} className="border-b border-line hover:bg-black/[0.02]">
                          <td className="py-2 px-3 text-sm text-ink">{p.name}</td>
                          <td className="py-2 px-3 text-sm text-ink">{p.address}</td>
                          <td className="py-2 px-3 text-sm text-ink">{p.city}</td>
                          <td className="py-2 px-3 text-sm"><Badge>{p.type}</Badge></td>
                        </tr>
                      ))}
                      {activeTab === 'units' && parsedData.units.map((u, i) => (
                        <tr key={i} className="border-b border-line hover:bg-black/[0.02]">
                          <td className="py-2 px-3 text-sm text-ink">{u.unitNumber}</td>
                          <td className="py-2 px-3 text-sm text-ink">{u.propertyId}</td>
                          <td className="py-2 px-3 text-sm text-ink">{u.bedrooms}bd/{u.bathrooms}ba</td>
                          <td className="py-2 px-3 text-sm text-right text-ink tnum">{formatCurrency(u.monthlyRent)}</td>
                        </tr>
                      ))}
                      {activeTab === 'tenants' && parsedData.tenants.map((t, i) => (
                        <tr key={i} className="border-b border-line hover:bg-black/[0.02]">
                          <td className="py-2 px-3 text-sm text-ink">{t.firstName} {t.lastName}</td>
                          <td className="py-2 px-3 text-sm text-ink">{t.email || '—'}</td>
                          <td className="py-2 px-3 text-sm text-ink">{t.phone || '—'}</td>
                        </tr>
                      ))}
                      {activeTab === 'leases' && parsedData.leases.map((l, i) => (
                        <tr key={i} className="border-b border-line hover:bg-black/[0.02]">
                          <td className="py-2 px-3 text-sm text-ink">{l.unitId || '—'}</td>
                          <td className="py-2 px-3 text-sm text-ink">{l.tenantIds.map(tenantName).join(', ') || '—'}</td>
                          <td className="py-2 px-3 text-sm text-right text-ink tnum">{formatCurrency(l.monthlyRent)}</td>
                          <td className="py-2 px-3 text-sm"><Badge variant={l.status === 'active' ? 'success' : l.status === 'paused' ? 'warning' : 'secondary'}>{l.status}</Badge></td>
                        </tr>
                      ))}
                      {activeTab === 'rents' && parsedData.rentPayments.map((r, i) => (
                        <tr key={i} className="border-b border-line hover:bg-black/[0.02]">
                          <td className="py-2 px-3 text-sm text-ink">{r.leaseId}</td>
                          <td className="py-2 px-3 text-sm text-ink">{r.paidByTenantId ? tenantName(r.paidByTenantId) : '—'}</td>
                          <td className="py-2 px-3 text-sm text-right text-ink tnum">{formatCurrency(r.amount)}</td>
                          <td className="py-2 px-3 text-sm"><Badge variant={r.status === 'paid' ? 'success' : 'warning'}>{r.status}</Badge></td>
                        </tr>
                      ))}
                      {activeTab === 'expenses' && parsedData.expenses.map((e, i) => (
                        <tr key={i} className="border-b border-line hover:bg-black/[0.02]">
                          <td className="py-2 px-3 text-sm text-ink">{e.category}</td>
                          <td className="py-2 px-3 text-sm text-right text-ink tnum">{formatCurrency(e.amount)}</td>
                          <td className="py-2 px-3 text-sm text-ink">{e.date}</td>
                          <td className="py-2 px-3 text-sm text-ink">{e.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Import Actions */}
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowPreview(false)}
                  disabled={importing}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleImport}
                  disabled={importing || errors.length > 0}
                >
                  {importing ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Importing...
                    </span>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Confirm Import
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
