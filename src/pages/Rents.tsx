import { useState, useMemo } from 'react';
import {
  DollarSign, Calendar, CheckCircle, XCircle, Clock,
  AlertCircle, Search, Download, Home, User, DoorOpen,
  TrendingUp, TrendingDown, FileText, Upload, CreditCard,
  Banknote, Wallet, Smartphone, Receipt
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, formatMonthYear } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { RentPayment, PaymentMethod } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const statusConfig = {
  paid: { label: 'Paid', color: 'success' as const, icon: CheckCircle },
  pending: { label: 'Pending', color: 'warning' as const, icon: Clock },
  overdue: { label: 'Overdue', color: 'destructive' as const, icon: AlertCircle },
  partial: { label: 'Partial', color: 'secondary' as const, icon: DollarSign },
};

const paymentMethodConfig: Record<PaymentMethod, { label: string; icon: typeof CreditCard }> = {
  check: { label: 'Check', icon: Banknote },
  money_order: { label: 'Money Order', icon: Receipt },
  zelle: { label: 'Zelle', icon: Smartphone },
  venmo: { label: 'Venmo', icon: Wallet },
  cash: { label: 'Cash', icon: Banknote },
  other: { label: 'Other', icon: CreditCard },
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Parse a single CSV line, honoring double-quoted fields (so values containing
// commas survive). Matches the format produced by the Export button.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

export function Rents() {
  const { rentPayments, tenants, properties, units, updatePaymentStatus, addRentPayment } = useApp();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<RentPayment['status'] | 'all'>('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [paymentYearFilter, setPaymentYearFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [view, setView] = useState<'payments' | 'annual' | 'tax'>('payments');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importData, setImportData] = useState('');
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isAddPaymentModalOpen, setIsAddPaymentModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<RentPayment | null>(null);
  const [recordForm, setRecordForm] = useState({
    receivedDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'check' as PaymentMethod,
    notes: '',
  });
  const [newPaymentForm, setNewPaymentForm] = useState({
    tenantId: '',
    amount: '',
    dueDate: new Date().toISOString().split('T')[0],
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    status: 'pending' as RentPayment['status'],
    paymentMethod: 'check' as PaymentMethod,
    receivedDate: '',
  });

  const stats = useMemo(() => {
    const totalDue = rentPayments.reduce((sum, r) => sum + r.amount, 0);
    const totalPaid = rentPayments
      .filter(r => r.status === 'paid')
      .reduce((sum, r) => sum + r.amount, 0);
    const totalOwed = rentPayments
      .filter(r => r.status === 'overdue' || r.status === 'pending')
      .reduce((sum, r) => sum + r.amount, 0);
    const collectionRate = totalDue > 0 ? (totalPaid / totalDue) * 100 : 0;

    return { totalDue, totalPaid, totalOwed, collectionRate };
  }, [rentPayments]);

  // Annual rent collection data
  const annualData = useMemo(() => {
    const year = parseInt(yearFilter);
    return MONTHS.map((monthName, index) => {
      const month = index + 1;
      const monthPayments = rentPayments.filter(r => r.month === month && r.year === year);
      const collected = monthPayments
        .filter(r => r.status === 'paid')
        .reduce((sum, r) => sum + r.amount, 0);
      const expected = monthPayments.reduce((sum, r) => sum + r.amount, 0);
      const overdue = monthPayments
        .filter(r => r.status === 'overdue')
        .reduce((sum, r) => sum + r.amount, 0);
      const pending = monthPayments
        .filter(r => r.status === 'pending')
        .reduce((sum, r) => sum + r.amount, 0);

      return {
        name: monthName.substring(0, 3),
        month,
        collected,
        expected,
        outstanding: expected - collected,
        overdue,
        pending,
        collectionRate: expected > 0 ? (collected / expected) * 100 : 0,
      };
    });
  }, [rentPayments, yearFilter]);

  // Tax summary data
  const taxData = useMemo(() => {
    const year = parseInt(yearFilter);
    const yearPayments = rentPayments.filter(r => r.year === year);

    const totalRentIncome = yearPayments
      .filter(r => r.status === 'paid')
      .reduce((sum, r) => sum + r.amount, 0);

    const totalExpected = yearPayments.reduce((sum, r) => sum + r.amount, 0);
    const totalOverdue = yearPayments
      .filter(r => r.status === 'overdue')
      .reduce((sum, r) => sum + r.amount, 0);
    const totalPending = yearPayments
      .filter(r => r.status === 'pending')
      .reduce((sum, r) => sum + r.amount, 0);

    // Quarterly breakdown
    const quarters = [
      { name: 'Q1', months: [1, 2, 3] },
      { name: 'Q2', months: [4, 5, 6] },
      { name: 'Q3', months: [7, 8, 9] },
      { name: 'Q4', months: [10, 11, 12] },
    ];

    const quarterlyData = quarters.map(q => {
      const qPayments = yearPayments.filter(r => q.months.includes(r.month));
      const qCollected = qPayments
        .filter(r => r.status === 'paid')
        .reduce((sum, r) => sum + r.amount, 0);
      const qExpected = qPayments.reduce((sum, r) => sum + r.amount, 0);

      return {
        name: q.name,
        collected: qCollected,
        expected: qExpected,
        outstanding: qExpected - qCollected,
      };
    });

    return {
      totalRentIncome,
      totalExpected,
      totalOverdue,
      totalPending,
      quarterlyData,
    };
  }, [rentPayments, yearFilter]);

  const monthlyData = useMemo(() => {
    const year = parseInt(yearFilter);
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return months.map(month => {
      const monthPayments = rentPayments.filter(r => r.month === month && r.year === year);
      const collected = monthPayments
        .filter(r => r.status === 'paid')
        .reduce((sum, r) => sum + r.amount, 0);
      const expected = monthPayments.reduce((sum, r) => sum + r.amount, 0);

      return {
        name: formatMonthYear(month, year).split(' ')[0],
        collected,
        expected,
        outstanding: expected - collected,
      };
    });
  }, [rentPayments, yearFilter]);

  const filteredPayments = useMemo(() => {
    return rentPayments
      .filter(payment => {
        const tenant = tenants.find(t => t.id === payment.tenantId);
        const property = properties.find(p => p.id === payment.propertyId);
        const unit = units.find(u => u.id === payment.unitId);

        const matchesSearch =
          !searchTerm ||
          `${tenant?.firstName} ${tenant?.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
          property?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          unit?.unitNumber.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus = statusFilter === 'all' || payment.status === statusFilter;
        const matchesMonth = monthFilter === 'all' || payment.month === parseInt(monthFilter);
        const matchesYear = paymentYearFilter === 'all' || payment.year === parseInt(paymentYearFilter);

        return matchesSearch && matchesStatus && matchesMonth && matchesYear;
      })
      .sort((a, b) => {
        // Sort by paidDate descending (newest first), then by dueDate descending
        if (a.paidDate && b.paidDate) {
          return new Date(b.paidDate).getTime() - new Date(a.paidDate).getTime();
        }
        if (a.paidDate) return -1;
        if (b.paidDate) return 1;
        return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
      });
  }, [rentPayments, searchTerm, statusFilter, monthFilter, paymentYearFilter, tenants, properties, units]);

  const getTenant = (tenantId: string) => tenants.find(t => t.id === tenantId);
  const getProperty = (propertyId: string) => properties.find(p => p.id === propertyId);
  const getUnit = (unitId: string) => units.find(u => u.id === unitId);

  const handleImport = async () => {
    const lines = importData.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      showToast('Nothing to import. Paste CSV rows (with a header row).', 'error');
      return;
    }

    // Map columns by header name so column order is flexible. Expected headers
    // match the Export format: Tenant, Property, Unit, Month, Year, Due Date,
    // Paid Date, Amount, Status.
    // Normalize headers (lowercase, strip spaces/underscores) so both the
    // Export format ("Due Date") and the documented format ("due_date") work.
    const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, '');
    const headers = parseCsvLine(lines[0]).map(norm);
    const col = (...aliases: string[]) => headers.findIndex(h => aliases.includes(h));
    const iTenant = col('tenant', 'tenantname');
    const iProperty = col('property', 'propertyname');
    const iUnit = col('unit', 'unitnumber');
    const iMonth = col('month');
    const iYear = col('year');
    const iDue = col('duedate');
    const iPaid = col('paiddate');
    const iAmount = col('amount');
    const iStatus = col('status');

    if (iAmount === -1) {
      showToast('CSV needs an "Amount" column. Try exporting first to see the format.', 'error');
      return;
    }

    const validStatuses: RentPayment['status'][] = ['paid', 'pending', 'overdue', 'partial'];
    let imported = 0;
    let skipped = 0;

    try {
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const amount = parseFloat((cells[iAmount] || '').replace(/[$,]/g, ''));
        if (isNaN(amount)) { skipped++; continue; }

        const tenantName = iTenant >= 0 ? (cells[iTenant] || '').trim().toLowerCase() : '';
        const propertyName = iProperty >= 0 ? (cells[iProperty] || '').trim().toLowerCase() : '';
        const unitNumber = iUnit >= 0 ? (cells[iUnit] || '').trim().toLowerCase() : '';

        const property = properties.find(p => p.name.trim().toLowerCase() === propertyName);
        const tenant = tenants.find(
          t => `${t.firstName} ${t.lastName}`.trim().toLowerCase() === tenantName
        );
        const unit = units.find(
          u => (u.unitNumber || '').trim().toLowerCase() === unitNumber &&
            (!property || u.propertyId === property.id)
        );

        const monthStr = iMonth >= 0 ? (cells[iMonth] || '').trim() : '';
        let month = MONTHS.findIndex(m => m.toLowerCase() === monthStr.toLowerCase()) + 1;
        if (month === 0) month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);
        const year = (iYear >= 0 && parseInt(cells[iYear], 10)) || new Date().getFullYear();

        const rawStatus = (iStatus >= 0 ? cells[iStatus] || '' : '').trim().toLowerCase() as RentPayment['status'];
        const status = validStatuses.includes(rawStatus) ? rawStatus : 'pending';
        const paidDate = iPaid >= 0 ? (cells[iPaid] || '').trim() : '';

        await addRentPayment({
          tenantId: tenant?.id || '',
          unitId: unit?.id || '',
          propertyId: property?.id || '',
          amount,
          dueDate: iDue >= 0 ? (cells[iDue] || '').trim() : '',
          paidDate: paidDate || undefined,
          status,
          month,
          year,
        });
        imported++;
      }

      if (imported > 0) {
        showToast(
          `Imported ${imported} payment${imported === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} invalid row${skipped === 1 ? '' : 's'}` : ''}.`,
          'success'
        );
        setIsImportModalOpen(false);
        setImportData('');
      } else {
        showToast('No valid rows found to import. Check the Amount column.', 'error');
      }
    } catch {
      showToast('Import failed partway through. Please check the CSV and try again.', 'error');
    }
  };

  const exportToCSV = () => {
    const headers = ['Tenant', 'Property', 'Unit', 'Month', 'Year', 'Due Date', 'Paid Date', 'Amount', 'Status'];
    const rows = filteredPayments.map(p => {
      const tenant = getTenant(p.tenantId);
      const property = getProperty(p.propertyId);
      const unit = getUnit(p.unitId);
      return [
        `${tenant?.firstName} ${tenant?.lastName}`,
        property?.name,
        unit?.unitNumber,
        MONTHS[p.month - 1],
        p.year,
        p.dueDate,
        p.paidDate || '',
        p.amount,
        p.status,
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rent-payments-${yearFilter}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Rent Management</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Track rent payments and outstanding balances
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => setIsImportModalOpen(true)} className="w-full sm:w-auto">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" onClick={exportToCSV} className="w-full sm:w-auto">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setIsAddPaymentModalOpen(true)} className="w-full sm:w-auto">
            <DollarSign className="h-4 w-4 mr-2" />
            Add Payment
          </Button>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-2 border-b overflow-x-auto">
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'payments'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setView('payments')}
        >
          Payments
        </button>
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'annual'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setView('annual')}
        >
          Annual Overview
        </button>
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'tax'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setView('tax')}
        >
          Tax Report
        </button>
      </div>

      {/* Year Filter */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium">Year:</label>
        <select
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
        >
          <option value="2030">2030</option>
          <option value="2029">2029</option>
          <option value="2028">2028</option>
          <option value="2027">2027</option>
          <option value="2026">2026</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
          <option value="2022">2022</option>
          <option value="2021">2021</option>
          <option value="2020">2020</option>
          <option value="2019">2019</option>
        </select>
      </div>

      {view === 'payments' && (
        <>
          {/* Stats Cards */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-positive">{formatCurrency(stats.totalPaid)}</div>
                <p className="text-xs text-muted-foreground">All time</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
                <AlertCircle className="h-4 w-4 text-danger" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-danger">{formatCurrency(stats.totalOwed)}</div>
                <p className="text-xs text-muted-foreground">Pending + Overdue</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Collection Rate</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.collectionRate.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Overall performance</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overdue Payments</CardTitle>
                <XCircle className="h-4 w-4 text-danger" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {rentPayments.filter(r => r.status === 'overdue').length}
                </div>
                <p className="text-xs text-muted-foreground">Require attention</p>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Collection Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="collected" fill="#10b981" name="Collected" />
                  <Bar dataKey="outstanding" fill="#ef4444" name="Outstanding" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by tenant, property, or unit..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RentPayment['status'] | 'all')}
            >
              <option value="all">All Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
              <option value="partial">Partial</option>
            </select>
            <select
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            >
              <option value="all">All Months</option>
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
              value={paymentYearFilter}
              onChange={(e) => setPaymentYearFilter(e.target.value)}
            >
              <option value="all">All Years</option>
              <option value="2030">2030</option>
              <option value="2029">2029</option>
              <option value="2028">2028</option>
              <option value="2027">2027</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
              <option value="2022">2022</option>
              <option value="2021">2021</option>
              <option value="2020">2020</option>
              <option value="2019">2019</option>
            </select>
          </div>

          {/* Payments Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full min-w-[900px] sm:min-w-0">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-4 font-medium">Tenant</th>
                      <th className="text-left py-3 px-4 font-medium">Property & Unit</th>
                      <th className="text-left py-3 px-4 font-medium">Period</th>
                      <th className="text-left py-3 px-4 font-medium">Due Date</th>
                      <th className="text-left py-3 px-4 font-medium">Received</th>
                      <th className="text-right py-3 px-4 font-medium">Amount</th>
                      <th className="text-center py-3 px-4 font-medium">Method</th>
                      <th className="text-center py-3 px-4 font-medium">Status</th>
                      <th className="text-center py-3 px-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map(payment => {
                      const tenant = getTenant(payment.tenantId);
                      const property = getProperty(payment.propertyId);
                      const unit = getUnit(payment.unitId);
                      const status = statusConfig[payment.status];
                      const StatusIcon = status.icon;
                      const methodConfig = payment.paymentMethod ? paymentMethodConfig[payment.paymentMethod] : null;
                      const MethodIcon = methodConfig?.icon;

                      return (
                        <tr key={payment.id} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {tenant?.firstName} {tenant?.lastName}
                              </span>
                            </div>
                          </td>

                          <td className="py-4 px-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Home className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{property?.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Unit {unit?.unitNumber}</span>
                              </div>
                            </div>
                          </td>

                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{formatMonthYear(payment.month, payment.year)}</span>
                            </div>
                          </td>

                          <td className="py-4 px-4 text-sm">
                            {formatDate(payment.dueDate)}
                          </td>

                          <td className="py-4 px-4 text-sm">
                            {payment.receivedDate ? (
                              <div className="space-y-1">
                                <span className="text-positive font-medium">{formatDate(payment.receivedDate)}</span>
                                {payment.uploadedBy && (
                                  <div className="text-xs text-muted-foreground">
                                    by {payment.uploadedBy}
                                  </div>
                                )}
                                {payment.uploadedAt && (
                                  <div className="text-xs text-muted-foreground">
                                    at {new Date(payment.uploadedAt).toLocaleTimeString()}
                                  </div>
                                )}
                              </div>
                            ) : payment.paidDate ? (
                              <span className="text-positive">{formatDate(payment.paidDate)}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>

                          <td className="py-4 px-4 text-right font-semibold">
                            {formatCurrency(payment.amount)}
                          </td>

                          <td className="py-4 px-4 text-center">
                            {methodConfig && MethodIcon ? (
                              <Badge variant="outline" className="flex items-center gap-1 w-fit mx-auto">
                                <MethodIcon className="h-3 w-3" />
                                {methodConfig.label}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </td>

                          <td className="py-4 px-4 text-center">
                            <Badge variant={status.color} className="flex items-center gap-1 w-fit mx-auto">
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          </td>

                          <td className="py-4 px-4 text-center">
                            {payment.status !== 'paid' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedPayment(payment);
                                  setIsRecordModalOpen(true);
                                }}
                              >
                                Record
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {filteredPayments.length === 0 && (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No payments found</h3>
              <p className="text-muted-foreground">Try adjusting your search or filters</p>
            </div>
          )}
        </>
      )}

      {view === 'annual' && (
        <>
          {/* Annual Summary Stats */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Annual Expected</CardTitle>
                <Calendar className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(annualData.reduce((s, m) => s + m.expected, 0))}</div>
                <p className="text-xs text-muted-foreground">Total rent expected</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Annual Collected</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-positive">{formatCurrency(annualData.reduce((s, m) => s + m.collected, 0))}</div>
                <p className="text-xs text-muted-foreground">Total rent collected</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Annual Outstanding</CardTitle>
                <TrendingDown className="h-4 w-4 text-danger" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-danger">{formatCurrency(annualData.reduce((s, m) => s + m.outstanding, 0))}</div>
                <p className="text-xs text-muted-foreground">Unpaid rent</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Collection Rate</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(annualData.reduce((s, m) => s + m.collectionRate, 0) / 12).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">Monthly average</p>
              </CardContent>
            </Card>
          </div>

          {/* Annual Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Annual Rent Collection - {yearFilter}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={annualData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="expected" fill="#3b82f6" name="Expected" />
                  <Bar dataKey="collected" fill="#10b981" name="Collected" />
                  <Bar dataKey="overdue" fill="#ef4444" name="Overdue" />
                  <Bar dataKey="pending" fill="#f59e0b" name="Pending" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Monthly Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-4 font-medium">Month</th>
                      <th className="text-right py-3 px-4 font-medium">Expected</th>
                      <th className="text-right py-3 px-4 font-medium">Collected</th>
                      <th className="text-right py-3 px-4 font-medium">Overdue</th>
                      <th className="text-right py-3 px-4 font-medium">Pending</th>
                      <th className="text-right py-3 px-4 font-medium">Collection Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annualData.map((month) => (
                      <tr key={month.month} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{MONTHS[month.month - 1]}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(month.expected)}</td>
                        <td className="py-3 px-4 text-right text-positive">{formatCurrency(month.collected)}</td>
                        <td className="py-3 px-4 text-right text-danger">{formatCurrency(month.overdue)}</td>
                        <td className="py-3 px-4 text-right text-warning">{formatCurrency(month.pending)}</td>
                        <td className="py-3 px-4 text-right">
                          <span className={`font-semibold ${month.collectionRate >= 95 ? 'text-positive' : month.collectionRate >= 80 ? 'text-warning' : 'text-danger'}`}>
                            {month.collectionRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {view === 'tax' && (
        <>
          {/* Tax Summary Cards */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Rent Income</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-positive">{formatCurrency(taxData.totalRentIncome)}</div>
                <p className="text-xs text-muted-foreground">Taxable income</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expected</CardTitle>
                <Calendar className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(taxData.totalExpected)}</div>
                <p className="text-xs text-muted-foreground">Full year potential</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overdue Amount</CardTitle>
                <AlertCircle className="h-4 w-4 text-danger" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-danger">{formatCurrency(taxData.totalOverdue)}</div>
                <p className="text-xs text-muted-foreground">Uncollected rent</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Collection</CardTitle>
                <Clock className="h-4 w-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">{formatCurrency(taxData.totalPending)}</div>
                <p className="text-xs text-muted-foreground">Awaiting payment</p>
              </CardContent>
            </Card>
          </div>

          {/* Quarterly Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Quarterly Summary for Tax Filing - {yearFilter}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-4 font-medium">Quarter</th>
                      <th className="text-right py-3 px-4 font-medium">Expected Rent</th>
                      <th className="text-right py-3 px-4 font-medium">Collected Rent</th>
                      <th className="text-right py-3 px-4 font-medium">Outstanding</th>
                      <th className="text-right py-3 px-4 font-medium">Collection Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxData.quarterlyData.map((q) => (
                      <tr key={q.name} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{q.name}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(q.expected)}</td>
                        <td className="py-3 px-4 text-right text-positive font-semibold">{formatCurrency(q.collected)}</td>
                        <td className="py-3 px-4 text-right text-danger">{formatCurrency(q.outstanding)}</td>
                        <td className="py-3 px-4 text-right">
                          <span className={`font-semibold ${(q.collected / q.expected * 100) >= 95 ? 'text-positive' : 'text-warning'}`}>
                            {q.expected > 0 ? (q.collected / q.expected * 100).toFixed(1) : 0}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Tax Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Tax Preparation Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-warning-soft border border-[#e9dcbe] rounded-lg p-4">
                <h4 className="font-semibold text-amber-800 mb-2">Important Tax Information</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-warning">
                  <li>Rent income is taxable and must be reported on your tax return</li>
                  <li>Security deposits are not taxable income unless kept</li>
                  <li>Late fees collected are considered rental income</li>
                  <li>Keep records of all expenses for deductions</li>
                </ul>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="font-semibold">Income to Report</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li className="flex justify-between">
                      <span>Rent payments received</span>
                      <span className="font-medium text-foreground">{formatCurrency(taxData.totalRentIncome)}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Late fees</span>
                      <span className="font-medium text-foreground">$0.00</span>
                    </li>
                    <li className="flex justify-between border-t pt-1">
                      <span className="font-semibold">Total Taxable Income</span>
                      <span className="font-bold text-foreground">{formatCurrency(taxData.totalRentIncome)}</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="font-semibold">Common Deductions</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>Property taxes</li>
                    <li>Mortgage interest</li>
                    <li>Insurance premiums</li>
                    <li>Maintenance and repairs</li>
                    <li>Management fees</li>
                    <li>Utilities (if paid by landlord)</li>
                    <li>Depreciation</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Import Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title="Import Rent Payments"
        size="lg"
      >
        <div className="space-y-4">
          <div className="bg-primary-soft border border-primary-line rounded-lg p-4">
            <h4 className="font-semibold text-primary mb-2">CSV Format</h4>
            <p className="text-sm text-primary-hover mb-2">
              Upload a CSV file with the following columns:
            </p>
            <code className="text-xs bg-primary-soft px-2 py-1 rounded block">
              tenant_name,property,unit,amount,due_date,month,year
            </code>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Paste CSV Data</label>
            <textarea
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              rows={10}
              placeholder="tenant_name,property,unit,amount,due_date,month,year&#10;John Doe,Sunset Apartments,101,2800,2024-01-01,1,2024"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setIsImportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleImport} className="flex-1">
              Import Data
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        isOpen={isRecordModalOpen}
        onClose={() => {
          setIsRecordModalOpen(false);
          setSelectedPayment(null);
          setRecordForm({
            receivedDate: new Date().toISOString().split('T')[0],
            paymentMethod: 'check',
            notes: '',
          });
        }}
        title="Record Payment"
        size="md"
      >
        {selectedPayment && (
          <div className="space-y-4">
            <div className="bg-primary-soft border border-primary-line rounded-lg p-4">
              <h4 className="font-semibold text-primary mb-1">Payment Details</h4>
              <div className="text-sm text-primary-hover space-y-1">
                <p>
                  <span className="font-medium">Tenant:</span>{' '}
                  {getTenant(selectedPayment.tenantId)?.firstName} {getTenant(selectedPayment.tenantId)?.lastName}
                </p>
                <p>
                  <span className="font-medium">Amount:</span>{' '}
                  {formatCurrency(selectedPayment.amount)}
                </p>
                <p>
                  <span className="font-medium">Period:</span>{' '}
                  {formatMonthYear(selectedPayment.month, selectedPayment.year)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Payment Method *</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(Object.keys(paymentMethodConfig) as PaymentMethod[]).map((method) => {
                  const config = paymentMethodConfig[method];
                  const Icon = config.icon;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setRecordForm({ ...recordForm, paymentMethod: method })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        recordForm.paymentMethod === method
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-line hover:border-primary/50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Date Received *</label>
              <input
                type="date"
                value={recordForm.receivedDate}
                onChange={(e) => setRecordForm({ ...recordForm, receivedDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <textarea
                value={recordForm.notes}
                onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })}
                rows={2}
                placeholder="Optional notes about this payment..."
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            <div className="bg-warning-soft border border-[#e9dcbe] rounded-lg p-3">
              <p className="text-sm text-warning">
                This payment will be recorded as received on {recordForm.receivedDate} via {paymentMethodConfig[recordForm.paymentMethod].label}.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setIsRecordModalOpen(false);
                  setSelectedPayment(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={async () => {
                  if (selectedPayment) {
                    try {
                      await updatePaymentStatus(
                        selectedPayment.id,
                        'paid',
                        {
                          receivedDate: recordForm.receivedDate,
                          paymentMethod: recordForm.paymentMethod,
                          uploadedBy: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
                        }
                      );
                      setIsRecordModalOpen(false);
                      setSelectedPayment(null);
                      setRecordForm({
                        receivedDate: new Date().toISOString().split('T')[0],
                        paymentMethod: 'check',
                        notes: '',
                      });
                    } catch (error) {
                      alert((error as Error).message);
                    }
                  }
                }}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Confirm Payment
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add New Rent Payment Modal */}
      <Modal
        isOpen={isAddPaymentModalOpen}
        onClose={() => {
          setIsAddPaymentModalOpen(false);
          setNewPaymentForm({
            tenantId: '',
            amount: '',
            dueDate: new Date().toISOString().split('T')[0],
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
            status: 'pending',
            paymentMethod: 'check',
            receivedDate: '',
          });
        }}
        title="Add Rent Payment"
        size="md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tenant *</label>
            <select
              value={newPaymentForm.tenantId}
              onChange={(e) => {
                const tenant = tenants.find(t => t.id === e.target.value);
                if (tenant) {
                  setNewPaymentForm({
                    ...newPaymentForm,
                    tenantId: e.target.value,
                    amount: tenant.monthlyRent.toString(),
                  });
                }
              }}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select Tenant</option>
              {tenants.filter(t => t.status === 'active').map(tenant => {
                const property = properties.find(p => p.id === tenant.propertyId);
                const unit = units.find(u => u.id === tenant.unitId);
                return (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.firstName} {tenant.lastName} - {property?.name} Unit {unit?.unitNumber} (${tenant.monthlyRent}/mo)
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newPaymentForm.amount}
                  onChange={(e) => setNewPaymentForm({ ...newPaymentForm, amount: e.target.value })}
                  className="w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Due Date *</label>
              <input
                type="date"
                value={newPaymentForm.dueDate}
                onChange={(e) => setNewPaymentForm({ ...newPaymentForm, dueDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Month *</label>
              <select
                value={newPaymentForm.month}
                onChange={(e) => setNewPaymentForm({ ...newPaymentForm, month: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Year *</label>
              <input
                type="number"
                value={newPaymentForm.year}
                onChange={(e) => setNewPaymentForm({ ...newPaymentForm, year: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <select
              value={newPaymentForm.status}
              onChange={(e) => setNewPaymentForm({ ...newPaymentForm, status: e.target.value as RentPayment['status'] })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="partial">Partial</option>
            </select>
          </div>

          {(newPaymentForm.status === 'paid' || newPaymentForm.status === 'partial') && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Payment Method *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(paymentMethodConfig) as PaymentMethod[]).filter(m => m !== 'other' && m !== 'money_order').map((method) => {
                    const config = paymentMethodConfig[method];
                    const Icon = config.icon;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setNewPaymentForm({ ...newPaymentForm, paymentMethod: method })}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                          newPaymentForm.paymentMethod === method
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-line hover:border-primary/50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Date Received *</label>
                <input
                  type="date"
                  value={newPaymentForm.receivedDate}
                  onChange={(e) => setNewPaymentForm({ ...newPaymentForm, receivedDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setIsAddPaymentModalOpen(false);
                setNewPaymentForm({
                  tenantId: '',
                  amount: '',
                  dueDate: new Date().toISOString().split('T')[0],
                  month: new Date().getMonth() + 1,
                  year: new Date().getFullYear(),
                  status: 'pending',
                  paymentMethod: 'check',
                  receivedDate: '',
                });
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!newPaymentForm.tenantId || !newPaymentForm.amount || ((newPaymentForm.status === 'paid' || newPaymentForm.status === 'partial') && !newPaymentForm.receivedDate)}
              onClick={async () => {
                const tenant = tenants.find(t => t.id === newPaymentForm.tenantId);
                if (tenant) {
                  try {
                    await addRentPayment({
                      tenantId: tenant.id,
                      unitId: tenant.unitId,
                      propertyId: tenant.propertyId,
                      amount: parseFloat(newPaymentForm.amount),
                      dueDate: newPaymentForm.dueDate,
                      status: newPaymentForm.status,
                      month: newPaymentForm.month,
                      year: newPaymentForm.year,
                      ...(newPaymentForm.status === 'paid' || newPaymentForm.status === 'partial' ? {
                        paidDate: newPaymentForm.receivedDate,
                        receivedDate: newPaymentForm.receivedDate,
                        paymentMethod: newPaymentForm.paymentMethod,
                        uploadedBy: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
                        uploadedAt: new Date().toISOString(),
                      } : {}),
                    });
                    setIsAddPaymentModalOpen(false);
                    setNewPaymentForm({
                      tenantId: '',
                      amount: '',
                      dueDate: new Date().toISOString().split('T')[0],
                      month: new Date().getMonth() + 1,
                      year: new Date().getFullYear(),
                      status: 'pending',
                      paymentMethod: 'check',
                      receivedDate: '',
                    });
                  } catch (error) {
                    alert((error as Error).message);
                  }
                }
              }}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Add Payment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
