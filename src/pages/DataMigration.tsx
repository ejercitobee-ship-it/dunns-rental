import { useState, useCallback } from 'react';
import {
  Upload, Download, FileText, AlertCircle, CheckCircle,
  X, Home, Users, DollarSign, Receipt, Building2,
  ArrowRight, Database
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type { Property, Unit, Tenant, RentPayment, Expense } from '../types';

interface ParsedData {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  rentPayments: RentPayment[];
  expenses: Expense[];
}

interface ValidationError {
  row: number;
  sheet: string;
  message: string;
  data?: string;
}

const SAMPLE_CSV = `=== PROPERTIES ===
id,name,address,city,state,zipCode,type,description
1,123 Main St,123 Main Street,Los Angeles,CA,90001,house,Single family home
2,456 Oak Ave,456 Oak Avenue,Santa Monica,CA,90401,apartment,Apartment building

=== UNITS ===
id,propertyId,unitNumber,bedrooms,bathrooms,squareFeet,monthlyRent,status
u1,1,A,3,2,1500,2500,occupied
u2,2,101,2,1,900,1800,occupied
u3,2,102,1,1,650,1400,vacant

=== TENANTS ===
id,unitId,propertyId,firstName,lastName,email,phone,leaseStart,leaseEnd,monthlyRent,securityDeposit,status
1,u1,1,John,Doe,john@email.com,(555) 123-4567,2024-01-01,2024-12-31,2500,5000,active
2,u2,2,Jane,Smith,jane@email.com,(555) 234-5678,2024-02-01,2025-01-31,1800,3600,active

=== RENT_PAYMENTS ===
id,tenantId,unitId,propertyId,amount,dueDate,paidDate,status,month,year
1,1,u1,1,2500,2024-01-01,2024-01-01,paid,1,2024
2,1,u1,1,2500,2024-02-01,2024-02-03,paid,2,2024
3,2,u2,2,1800,2024-01-01,2024-01-02,paid,1,2024

=== EXPENSES ===
id,propertyId,unitId,category,amount,date,description,vendor,isRecurring
1,1,,utilities,150,2024-01-15,Electric bill,Power Co,false
2,1,u1,repairs,200,2024-02-10,Plumbing fix,Plumber Pro,false
3,2,,insurance,300,2024-01-01,Property insurance,Insurance Co,true`;

export function DataMigration() {
  const { addProperty, addUnit, addTenant, addExpense } = useApp();
  const { showToast } = useToast();
  const [csvData, setCsvData] = useState('');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'properties' | 'units' | 'tenants' | 'rents' | 'expenses'>('all');

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
            if (cols.length >= 11) {
              data.tenants.push({
                id: cols[0],
                unitId: cols[1],
                propertyId: cols[2],
                firstName: cols[3],
                lastName: cols[4],
                email: cols[5],
                phone: cols[6],
                leaseStart: cols[7],
                leaseEnd: cols[8],
                monthlyRent: parseFloat(cols[9]) || 0,
                securityDeposit: parseFloat(cols[10]) || 0,
                status: (cols[11] as Tenant['status']) || 'active',
                notes: cols[12] || '',
              });
            }
            break;

          case 'rent_payments':
            if (cols.length >= 9) {
              data.rentPayments.push({
                id: cols[0],
                tenantId: cols[1],
                unitId: cols[2],
                propertyId: cols[3],
                amount: parseFloat(cols[4]) || 0,
                dueDate: cols[5],
                paidDate: cols[6] || undefined,
                status: (cols[7] as RentPayment['status']) || 'pending',
                month: parseInt(cols[8]) || 1,
                year: parseInt(cols[9]) || new Date().getFullYear(),
                notes: cols[10] || '',
              });
            }
            break;

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
                recurringFrequency: cols[9] as 'monthly' | 'quarterly' | 'yearly' || undefined,
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
      showToast('Please paste CSV data first', 'error');
      return;
    }

    const { data, errors } = parseCSV(csvData);
    setParsedData(data);
    setErrors(errors);
    setShowPreview(true);

    if (errors.length === 0) {
      showToast(`Found ${data.properties.length} properties, ${data.units.length} units, ${data.tenants.length} tenants, ${data.rentPayments.length} payments, ${data.expenses.length} expenses`, 'success');
    }
  };

  const handleImport = async () => {
    if (!parsedData) return;

    setImporting(true);
    let imported = 0;

    try {
      // Import properties first
      for (const property of parsedData.properties) {
        addProperty({
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
        imported++;
      }

      // Then units
      for (const unit of parsedData.units) {
        addUnit({
          propertyId: unit.propertyId,
          unitNumber: unit.unitNumber,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          squareFeet: unit.squareFeet,
          monthlyRent: unit.monthlyRent,
          status: unit.status,
          description: unit.description,
        });
        imported++;
      }

      // Then tenants
      for (const tenant of parsedData.tenants) {
        addTenant({
          unitId: tenant.unitId,
          propertyId: tenant.propertyId,
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          email: tenant.email,
          phone: tenant.phone,
          leaseStart: tenant.leaseStart,
          leaseEnd: tenant.leaseEnd,
          monthlyRent: tenant.monthlyRent,
          securityDeposit: tenant.securityDeposit,
          status: tenant.status,
          notes: tenant.notes,
        });
        imported++;
      }

      // Then expenses
      for (const expense of parsedData.expenses) {
        addExpense({
          propertyId: expense.propertyId,
          unitId: expense.unitId,
          category: expense.category,
          amount: expense.amount,
          date: expense.date,
          description: expense.description,
          vendor: expense.vendor,
          isRecurring: expense.isRecurring,
          recurringFrequency: expense.recurringFrequency,
        });
        imported++;
      }

      showToast(`Successfully imported ${imported} records!`, 'success');
      setShowPreview(false);
      setCsvData('');
      setParsedData(null);
    } catch (err) {
      showToast('Import failed. Please check your data.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const getTabCount = (tab: string) => {
    if (!parsedData) return 0;
    switch (tab) {
      case 'properties': return parsedData.properties.length;
      case 'units': return parsedData.units.length;
      case 'tenants': return parsedData.tenants.length;
      case 'rents': return parsedData.rentPayments.length;
      case 'expenses': return parsedData.expenses.length;
      default: return parsedData.properties.length + parsedData.units.length + parsedData.tenants.length + parsedData.rentPayments.length + parsedData.expenses.length;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Migration</h1>
          <p className="text-muted-foreground mt-1">
            Import all your data in one go from CSV
          </p>
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
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
              <p className="text-sm text-muted-foreground">
                Get the sample CSV file with the correct format for all data types.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">2</span>
                Fill Your Data
              </div>
              <p className="text-sm text-muted-foreground">
                Replace the sample data with your actual properties, units, tenants, rents, and expenses.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">3</span>
                Paste & Import
              </div>
              <p className="text-sm text-muted-foreground">
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
            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Your CSV file should have sections separated by headers:</p>
              <code className="block bg-slate-900 text-green-400 px-4 py-3 rounded-lg text-xs font-mono overflow-x-auto">
                === PROPERTIES ===<br/>
                id,name,address,city,state,zipCode,type,description<br/>
                <br/>
                === UNITS ===<br/>
                id,propertyId,unitNumber,bedrooms,bathrooms,squareFeet,monthlyRent,status<br/>
                <br/>
                === TENANTS ===<br/>
                id,unitId,propertyId,firstName,lastName,email,phone,leaseStart,leaseEnd,monthlyRent,securityDeposit,status<br/>
                <br/>
                === RENT_PAYMENTS ===<br/>
                id,tenantId,unitId,propertyId,amount,dueDate,paidDate,status,month,year<br/>
                <br/>
                === EXPENSES ===<br/>
                id,propertyId,unitId,category,amount,date,description,vendor,isRecurring
              </code>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Property Types
                </h4>
                <p className="text-sm text-muted-foreground">house, apartment, condo, townhouse, multi-family</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Home className="h-4 w-4" /> Unit Status
                </h4>
                <p className="text-sm text-muted-foreground">occupied, vacant, maintenance</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4" /> Tenant Status
                </h4>
                <p className="text-sm text-muted-foreground">active, inactive, pending</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Payment Status
                </h4>
                <p className="text-sm text-muted-foreground">paid, pending, overdue, partial</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4" /> Expense Categories
                </h4>
                <p className="text-sm text-muted-foreground">maintenance, utilities, insurance, taxes, mortgage, repairs, cleaning, landscaping, management, other</p>
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
            className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
          />

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCsvData('');
                setParsedData(null);
                setErrors([]);
              }}
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
            <Button onClick={handleValidate} disabled={!csvData.trim()}>
              <ArrowRight className="h-4 w-4 mr-2" />
              Validate & Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <Modal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        title="Import Preview"
        size="xl"
      >
        <div className="space-y-6">
          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="font-semibold text-red-800 flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4" />
                Validation Errors ({errors.length})
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {errors.map((err, i) => (
                  <div key={i} className="text-sm text-red-700">
                    Row {err.row} in {err.sheet}: {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Cards */}
          {parsedData && (
            <>
              <div className="grid grid-cols-5 gap-3">
                {[
                  { key: 'properties', label: 'Properties', icon: Building2, count: parsedData.properties.length },
                  { key: 'units', label: 'Units', icon: Home, count: parsedData.units.length },
                  { key: 'tenants', label: 'Tenants', icon: Users, count: parsedData.tenants.length },
                  { key: 'rents', label: 'Payments', icon: DollarSign, count: parsedData.rentPayments.length },
                  { key: 'expenses', label: 'Expenses', icon: Receipt, count: parsedData.expenses.length },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key as typeof activeTab)}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      activeTab === item.key
                        ? 'border-primary bg-primary/5'
                        : 'border-slate-200 hover:border-primary/50'
                    }`}
                  >
                    <item.icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                    <div className="text-2xl font-bold">{item.count}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-4 py-2 border-b flex items-center justify-between">
                  <span className="font-medium">
                    {activeTab === 'all' ? 'All Data' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                  </span>
                  <Badge variant="secondary">{getTabCount(activeTab)} records</Badge>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {activeTab === 'properties' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium">Name</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Address</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">City</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Type</th>
                          </>
                        )}
                        {activeTab === 'units' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium">Unit</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Property</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Bed/Bath</th>
                            <th className="text-right py-2 px-3 text-sm font-medium">Rent</th>
                          </>
                        )}
                        {activeTab === 'tenants' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium">Name</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Email</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Phone</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Lease</th>
                          </>
                        )}
                        {activeTab === 'rents' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium">Tenant ID</th>
                            <th className="text-right py-2 px-3 text-sm font-medium">Amount</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Due Date</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Status</th>
                          </>
                        )}
                        {activeTab === 'expenses' && (
                          <>
                            <th className="text-left py-2 px-3 text-sm font-medium">Category</th>
                            <th className="text-right py-2 px-3 text-sm font-medium">Amount</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Date</th>
                            <th className="text-left py-2 px-3 text-sm font-medium">Description</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {activeTab === 'all' && (
                        <>
                          {parsedData.properties.map((p, i) => (
                            <tr key={`p-${i}`} className="border-b hover:bg-muted/30">
                              <td className="py-2 px-3 text-sm" colSpan={4}>
                                <span className="font-medium">{ p.name }</span> - {p.address}, {p.city}
                              </td>
                            </tr>
                          ))}
                          {parsedData.units.map((u, i) => (
                            <tr key={`u-${i}`} className="border-b hover:bg-muted/30">
                              <td className="py-2 px-3 text-sm" colSpan={4}>
                                Unit {u.unitNumber} - {u.bedrooms}bd/{u.bathrooms}ba - ${u.monthlyRent}/mo
                              </td>
                            </tr>
                          ))}
                          {parsedData.tenants.map((t, i) => (
                            <tr key={`t-${i}`} className="border-b hover:bg-muted/30">
                              <td className="py-2 px-3 text-sm" colSpan={4}>
                                {t.firstName} {t.lastName} - {t.email}
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                      {activeTab === 'properties' && parsedData.properties.map((p, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 text-sm">{p.name}</td>
                          <td className="py-2 px-3 text-sm">{p.address}</td>
                          <td className="py-2 px-3 text-sm">{p.city}</td>
                          <td className="py-2 px-3 text-sm"><Badge>{p.type}</Badge></td>
                        </tr>
                      ))}
                      {activeTab === 'units' && parsedData.units.map((u, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 text-sm">{u.unitNumber}</td>
                          <td className="py-2 px-3 text-sm">{u.propertyId}</td>
                          <td className="py-2 px-3 text-sm">{u.bedrooms}bd/{u.bathrooms}ba</td>
                          <td className="py-2 px-3 text-sm text-right">${u.monthlyRent}</td>
                        </tr>
                      ))}
                      {activeTab === 'tenants' && parsedData.tenants.map((t, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 text-sm">{t.firstName} {t.lastName}</td>
                          <td className="py-2 px-3 text-sm">{t.email}</td>
                          <td className="py-2 px-3 text-sm">{t.phone}</td>
                          <td className="py-2 px-3 text-sm">{t.leaseStart} to {t.leaseEnd}</td>
                        </tr>
                      ))}
                      {activeTab === 'rents' && parsedData.rentPayments.map((r, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 text-sm">{r.tenantId}</td>
                          <td className="py-2 px-3 text-sm text-right">${r.amount}</td>
                          <td className="py-2 px-3 text-sm">{r.dueDate}</td>
                          <td className="py-2 px-3 text-sm"><Badge variant={r.status === 'paid' ? 'success' : 'warning'}>{r.status}</Badge></td>
                        </tr>
                      ))}
                      {activeTab === 'expenses' && parsedData.expenses.map((e, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 text-sm">{e.category}</td>
                          <td className="py-2 px-3 text-sm text-right">${e.amount}</td>
                          <td className="py-2 px-3 text-sm">{e.date}</td>
                          <td className="py-2 px-3 text-sm">{e.description}</td>
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
