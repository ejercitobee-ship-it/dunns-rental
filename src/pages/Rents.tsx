import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign, Calendar, CheckCircle, XCircle, Clock, AlertCircle,
  Search, Download, Upload,
  TrendingUp, TrendingDown, FileText, ChevronRight, ChevronDown,
  CreditCard, Banknote, Wallet, Smartphone, Receipt, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatMonthYear, todayLocalDate, formatDate } from '../lib/utils';
import { rentSheetApi, documentsApi, leasesApi } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { activeLeases, settleMonth, leasesOwingMonth, rentIncomeForYear, rentIncomeForMonths, groupLeaseMonthRows, unsettledMonths, type MonthSettlement } from '../lib/rent';
import type { Lease, RentPayment, PaymentMethod, Property, Unit, Tenant } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

/** One row of the payments table: a single lease, a single month, settled. */
interface LeaseMonthRow {
  lease: Lease;
  unit?: Unit;
  property?: Property;
  occupants: Tenant[];
  month: number;
  year: number;
  settlement: MonthSettlement;
}

const settlementStatusConfig: Record<MonthSettlement['status'], { label: string; color: 'success' | 'warning' | 'destructive'; icon: typeof CheckCircle }> = {
  paid: { label: 'Paid', color: 'success', icon: CheckCircle },
  partial: { label: 'Partial', color: 'warning', icon: Clock },
  unpaid: { label: 'Unpaid', color: 'destructive', icon: AlertCircle },
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

// Quote a CSV field if it contains a comma, quote or newline, so the
// "Occupants" column (which can itself contain a comma-separated list of
// names) round-trips through the Import box.
function csvField(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// A CSV "tenant"/"occupants" cell may name one person or several (the Export
// button joins every occupant with ", "). Attribute the payment only when
// exactly one of the named people is actually on this lease: with zero or
// several matches we cannot tell who paid, so paidByTenantId is left unset
// rather than guessed at.
function matchSinglePayer(cell: string, occupants: Tenant[]): Tenant | undefined {
  const names = cell.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) return undefined;
  const matches = occupants.filter(t => names.includes(`${t.firstName} ${t.lastName}`.trim().toLowerCase()));
  return matches.length === 1 ? matches[0] : undefined;
}

export function Rents() {
  const {
    properties, units, leases, rentPayments,
    getLeaseTenants, addRentPayment, deleteRentPayment, refreshData,
  } = useApp();
  const { isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [view, setView] = useState<'payments' | 'annual' | 'tax'>('payments');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importData, setImportData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  // Synchronous re-entry guard: isImporting (state) only disables the button
  // after a render, so a fast double-click could start a second overlapping
  // import loop before that render lands and create duplicate payments.
  const isImportingRef = useRef(false);

  // Draft leases a realtor placed but Belle has not finalized yet. These owe
  // no rent (needsReview leases are excluded from leasesOwingMonth), so they
  // never show up in the table below. This section is the only place on the
  // page they are discoverable.
  const draftLeases = leases.filter(l => l.needsReview);

  const [recordRow, setRecordRow] = useState<LeaseMonthRow | null>(null);
  const [recordForm, setRecordForm] = useState({
    amount: '',
    paidByTenantId: '',
    receivedDate: todayLocalDate(),
    paymentMethod: 'check' as PaymentMethod,
    notes: '',
  });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  // Move-in fee collection.
  const [mifLease, setMifLease] = useState<Lease | null>(null);
  const [mifForm, setMifForm] = useState({ amount: '', date: todayLocalDate(), method: 'check' as PaymentMethod });
  const [mifBusy, setMifBusy] = useState(false);

  const openMoveInFee = (lease: Lease) => {
    setMifLease(lease);
    setMifForm({ amount: lease.securityDeposit ? String(lease.securityDeposit) : '', date: todayLocalDate(), method: 'check' });
  };

  const submitMoveInFee = async () => {
    if (!mifLease || mifBusy) return;
    const amount = Number(mifForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Enter a valid amount.', 'error'); return; }
    if (!mifForm.date) { showToast('Enter the date paid.', 'error'); return; }
    setMifBusy(true);
    try {
      const res = await leasesApi.recordMoveInFee(mifLease.id, { amount, paidDate: mifForm.date, method: mifForm.method });
      await refreshData();
      showToast(res.receiptDocumentId ? 'Move-in fee recorded. Receipt sent to the tenant.' : 'Move-in fee recorded.', 'success');
      setMifLease(null);
    } catch (err) {
      showToast((err as Error).message || 'Could not record the move-in fee.', 'error');
    } finally {
      setMifBusy(false);
    }
  };
  // Same synchronous guard as the import loop above, for the same reason:
  // a double-click on "Record Payment" must not create two payments.
  const isRecordingRef = useRef(false);

  // "Mark rent paid through …": settles a backdated tenant's owed history in
  // one action. Holds the lease being settled, the household on it (so a
  // payer can be credited), and the last month to mark paid (YYYY-MM).
  const [settleTarget, setSettleTarget] = useState<{ lease: Lease; names: string; occupants: Tenant[] } | null>(null);
  const [settleThrough, setSettleThrough] = useState('');
  const [settlePayer, setSettlePayer] = useState('');
  const [isSettling, setIsSettling] = useState(false);
  const isSettlingRef = useRef(false);

  // Which tenant rows are expanded to show their month-by-month detail.
  // Everything starts collapsed; the row summary carries this month's status
  // and the overdue flag, so most work happens without expanding at all.
  const [expandedLeaseIds, setExpandedLeaseIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (leaseId: string) =>
    setExpandedLeaseIds(prev => {
      const next = new Set(prev);
      if (next.has(leaseId)) next.delete(leaseId);
      else next.add(leaseId);
      return next;
    });

  // Annual rent collection data. Walks every month of the year against
  // leasesOwingMonth, which is every lease whose term covered that month
  // whether or not it has since ended, so a lease ended at turnover mid-year
  // still counts for the months it was lived in. This is what fixes the old
  // reading of near 100% collection: the previous version summed raw payment
  // rows, which only ever exist for months someone actually paid, so
  // "expected" and "collected" were nearly the same number by construction.
  const annualData = useMemo(() => {
    const year = parseInt(yearFilter, 10);
    return MONTHS.map((monthName, index) => {
      const month = index + 1;
      let expected = 0;
      let collected = 0;
      let outstanding = 0;
      for (const lease of leasesOwingMonth(leases, month, year)) {
        const s = settleMonth(lease, rentPayments, month, year);
        expected += s.due;
        collected += s.paid;
        outstanding += s.balance;
      }

      return {
        name: monthName.substring(0, 3),
        month,
        collected,
        expected,
        outstanding,
        collectionRate: expected > 0 ? (collected / expected) * 100 : 0,
      };
    });
  }, [leases, rentPayments, yearFilter]);

  // Tax summary data. "Expected" and "Outstanding" still walk leasesOwingMonth
  // like annualData above, because those answer what was owed against the
  // lease calendar. "Total Rent Income" does not: it calls rentIncomeForYear,
  // the same function the Tax Report page uses, so the two pages report the
  // same taxable income even for a payment recorded outside any lease's owed
  // months (for example, one entered after a lease's endDate).
  const taxData = useMemo(() => {
    const year = parseInt(yearFilter, 10);

    const quarters = [
      { name: 'Q1', months: [1, 2, 3] },
      { name: 'Q2', months: [4, 5, 6] },
      { name: 'Q3', months: [7, 8, 9] },
      { name: 'Q4', months: [10, 11, 12] },
    ];

    const quarterlyData = quarters.map(q => {
      // Expected is what the leases owed for those months. Collected is money
      // received in them, the same definition the total above uses, so the
      // four quarters add up to it rather than falling short of it.
      let qExpected = 0;
      for (const month of q.months) {
        for (const lease of leasesOwingMonth(leases, month, year)) {
          qExpected += settleMonth(lease, rentPayments, month, year).due;
        }
      }
      const qCollected = rentIncomeForMonths(rentPayments, q.months, year);
      return {
        name: q.name,
        collected: qCollected,
        expected: qExpected,
        outstanding: qExpected - qCollected,
      };
    });

    const totalRentIncome = rentIncomeForYear(rentPayments, year);
    const totalExpected = quarterlyData.reduce((sum, q) => sum + q.expected, 0);
    const totalOutstanding = quarterlyData.reduce((sum, q) => sum + q.outstanding, 0);

    return {
      totalRentIncome,
      totalExpected,
      totalOutstanding,
      quarterlyData,
    };
  }, [leases, rentPayments, yearFilter]);

  // One row per lease per month of the selected year that the lease OWED
  // rent for (leasesOwingMonth), whether or not it has since ended. This,
  // not the raw payment list, is what the Payments table renders: rent is
  // owed once per lease per month regardless of how many payments (or
  // people) it took to settle it, and a lease that ended at turnover still
  // owed, and shows, every month it covered before that.
  const leaseMonthRows = useMemo(() => {
    const year = parseInt(yearFilter, 10);
    const rows: LeaseMonthRow[] = [];
    for (let month = 1; month <= 12; month++) {
      for (const lease of leasesOwingMonth(leases, month, year)) {
        const unit = lease.unitId ? units.find(u => u.id === lease.unitId) : undefined;
        const property = lease.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
        const occupants = getLeaseTenants(lease.id);
        rows.push({
          lease,
          unit,
          property,
          occupants,
          month,
          year,
          settlement: settleMonth(lease, rentPayments, month, year),
        });
      }
    }
    return rows.sort((a, b) =>
      a.month - b.month ||
      (a.property?.name || '').localeCompare(b.property?.name || '') ||
      (a.unit?.unitNumber || '').localeCompare(b.unit?.unitNumber || '')
    );
  }, [leases, units, properties, rentPayments, yearFilter, getLeaseTenants]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return leaseMonthRows;
    return leaseMonthRows.filter(row => {
      const matchesOccupant = row.occupants.some(t =>
        `${t.firstName} ${t.lastName}`.toLowerCase().includes(q)
      );
      return (
        (row.unit?.unitNumber || '').toLowerCase().includes(q) ||
        (row.property?.name || '').toLowerCase().includes(q) ||
        matchesOccupant
      );
    });
  }, [leaseMonthRows, searchTerm]);

  // Collapse the filtered rows into one group per lease (labeled by its
  // occupants) for the redesigned list. Pre-sort by property then unit so that
  // order holds within each attention bucket, since groupLeaseMonthRows sorts
  // attention-first with a stable sort.
  const tenantGroups = useMemo(() => {
    const byPropertyUnit = [...filteredRows].sort((a, b) =>
      (a.property?.name || '').localeCompare(b.property?.name || '') ||
      (a.unit?.unitNumber || '').localeCompare(b.unit?.unitNumber || '') ||
      a.month - b.month
    );
    const today = new Date();
    return groupLeaseMonthRows(byPropertyUnit, parseInt(yearFilter, 10), today.getFullYear(), today.getMonth() + 1);
  }, [filteredRows, yearFilter]);

  // A future year has nothing due yet, so a fully-unowed row reads "Upcoming"
  // rather than the "All paid" a past/current year would show.
  const isFutureYear = parseInt(yearFilter, 10) > new Date().getFullYear();

  // Stat cards for the selected year. "Elapsed" months are the ones that
  // have already started, so a future year (or the tail end of the current
  // year) doesn't get counted as outstanding before it's even due.
  const yearStats = useMemo(() => {
    const year = parseInt(yearFilter, 10);
    const today = new Date();
    const elapsedCount = year < today.getFullYear() ? 12 : year > today.getFullYear() ? 0 : today.getMonth() + 1;
    const elapsedMonths = Array.from({ length: elapsedCount }, (_, i) => i + 1);

    let totalDue = 0;
    let totalPaidElapsed = 0;
    let outstanding = 0;
    let overdueCount = 0;

    for (const month of elapsedMonths) {
      for (const lease of leasesOwingMonth(leases, month, year)) {
        const s = settleMonth(lease, rentPayments, month, year);
        totalDue += s.due;
        totalPaidElapsed += s.paid;
        outstanding += s.balance;
        if (s.status !== 'paid') overdueCount += 1;
      }
    }

    // Sum the same settlements the table renders (leaseMonthRows), so this
    // top-line figure can never disagree with the rows beneath it.
    const totalCollected = leaseMonthRows.reduce((sum, row) => sum + row.settlement.paid, 0);

    const collectionRate = totalDue > 0 ? (totalPaidElapsed / totalDue) * 100 : 0;

    return { totalCollected, outstanding, collectionRate, overdueCount };
  }, [leases, rentPayments, yearFilter, leaseMonthRows]);

  const statCards = [
    { label: 'Total Collected', value: formatCurrency(yearStats.totalCollected), icon: <DollarSign />, valueClass: 'text-ink' },
    { label: 'Outstanding', value: formatCurrency(yearStats.outstanding), icon: <AlertCircle />, valueClass: yearStats.outstanding > 0 ? 'text-danger' : 'text-ink' },
    { label: 'Collection Rate', value: `${yearStats.collectionRate.toFixed(1)}%`, icon: <TrendingUp />, valueClass: 'text-ink' },
    { label: 'Overdue', value: yearStats.overdueCount, icon: <XCircle />, valueClass: yearStats.overdueCount > 0 ? 'text-danger' : 'text-ink' },
  ];

  // Super Admin only: undo a mistakenly recorded payment. Removes every payment
  // logged for this lease-month (and its receipt), so the month goes back to owed.
  const [deletingRow, setDeletingRow] = useState<string | null>(null);
  const handleDeleteRent = async (mr: LeaseMonthRow) => {
    const pmts = rentPayments.filter(
      pm => pm.leaseId === mr.lease.id && pm.month === mr.month && pm.year === mr.year
    );
    if (pmts.length === 0) return;
    const total = pmts.reduce((sum, p) => sum + (p.amount || 0), 0);
    const label = `${pmts.length} payment${pmts.length > 1 ? 's' : ''} totaling ${formatCurrency(total)}`;
    if (!confirm(
      `Delete the recorded rent for ${formatMonthYear(mr.month, mr.year)}?\n\nThis removes ${label} and any receipt, and the month goes back to owed. This cannot be undone.`
    )) return;
    const rowKey = `${mr.lease.id}-${mr.month}-${mr.year}`;
    setDeletingRow(rowKey);
    try {
      for (const p of pmts) await deleteRentPayment(p.id);
      showToast('Rent payment deleted. The month is back to owed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete the payment', 'error');
    } finally {
      setDeletingRow(null);
    }
  };

  const openRecordModal = (row: LeaseMonthRow) => {
    setRecordRow(row);
    setProofFile(null);
    if (proofInputRef.current) proofInputRef.current.value = '';
    setRecordForm({
      amount: row.settlement.balance > 0 ? String(row.settlement.balance) : '',
      paidByTenantId: '',
      receivedDate: todayLocalDate(),
      paymentMethod: 'check',
      notes: '',
    });
  };

  const closeRecordModal = () => {
    setRecordRow(null);
    setProofFile(null);
    if (proofInputRef.current) proofInputRef.current.value = '';
    setRecordForm({
      amount: '',
      paidByTenantId: '',
      receivedDate: todayLocalDate(),
      paymentMethod: 'check',
      notes: '',
    });
  };

  const handleRecordPayment = async () => {
    // Bail out synchronously if a submit is already in flight so a fast
    // double-click can't slip a second addRentPayment through before
    // isRecording (state) has re-rendered the disabled button.
    if (isRecordingRef.current || !recordRow) return;

    const amount = Number(recordForm.amount);
    if (!recordForm.amount || Number.isNaN(amount) || amount <= 0) {
      showToast('Enter an amount greater than zero.', 'error');
      return;
    }
    if (!recordForm.receivedDate) {
      showToast('Enter the date received.', 'error');
      return;
    }

    isRecordingRef.current = true;
    setIsRecording(true);
    try {
      const dueDate = `${recordRow.year}-${String(recordRow.month).padStart(2, '0')}-01`;
      await addRentPayment({
        leaseId: recordRow.lease.id,
        paidByTenantId: recordForm.paidByTenantId || undefined,
        amount: Number(recordForm.amount),
        month: recordRow.month,
        year: recordRow.year,
        status: 'paid',
        receivedDate: recordForm.receivedDate,
        paidDate: recordForm.receivedDate,
        paymentMethod: recordForm.paymentMethod,
        dueDate,
        notes: recordForm.notes.trim() || undefined,
      });

      // Save the proof of payment to the tenant's Drive folder. Best-effort:
      // a Drive hiccup must never lose the recorded payment.
      let proofNote = '';
      if (proofFile) {
        const tenantId = recordForm.paidByTenantId || recordRow.occupants[0]?.id;
        if (tenantId) {
          try {
            const dot = proofFile.name.lastIndexOf('.');
            const ext = dot >= 0 ? proofFile.name.slice(dot) : '';
            const named = new File(
              [proofFile],
              `Proof of payment - ${formatMonthYear(recordRow.month, recordRow.year)}${ext}`,
              { type: proofFile.type || 'application/octet-stream' }
            );
            // Office-only: the proof is the landlord's record, hidden from the
            // tenant portal.
            await documentsApi.upload(named, { tenantId, officeOnly: true });
            proofNote = ' Proof uploaded.';
          } catch {
            proofNote = ' The payment saved, but the proof upload failed (add it from the tenant\'s Documents).';
          }
        }
      }
      showToast(`Payment recorded.${proofNote}`, proofNote.includes('failed') ? 'error' : 'success');
      closeRecordModal();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  };

  // The most recently completed month (last month) as YYYY-MM, the sensible
  // default "paid through" so the current month is left for normal collection.
  const lastMonthValue = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const openSettleModal = (lease: Lease, names: string, occupants: Tenant[]) => {
    setSettleTarget({ lease, names, occupants });
    setSettleThrough(lastMonthValue());
    setSettlePayer('');
  };

  const closeSettleModal = () => {
    setSettleTarget(null);
    setSettleThrough('');
    setSettlePayer('');
  };

  // Parse the YYYY-MM picker into month/year, then the owed-but-unpaid months
  // for this lease from its start through that month.
  const settlePreview = (() => {
    if (!settleTarget || !settleThrough) return [] as { month: number; year: number; amount: number }[];
    const [y, m] = settleThrough.split('-').map(Number);
    if (!y || !m) return [];
    return unsettledMonths(settleTarget.lease, rentPayments, m, y);
  })();
  const settleTotal = settlePreview.reduce((sum, r) => sum + r.amount, 0);

  const handleSettleBackRent = async () => {
    if (isSettlingRef.current || !settleTarget) return;
    if (settlePreview.length === 0) {
      showToast('Nothing to settle for that period.', 'error');
      return;
    }
    isSettlingRef.current = true;
    setIsSettling(true);
    try {
      // Record each owed month as paid for exactly its remaining balance, so a
      // month with a partial payment is topped up, not doubled. Defer the Google
      // Sheet mirror until the final row so it syncs once, not once per month.
      const rows = settlePreview;
      for (let i = 0; i < rows.length; i++) {
        const { month, year, amount } = rows[i];
        const dueDate = `${year}-${String(month).padStart(2, '0')}-01`;
        await addRentPayment(
          {
            leaseId: settleTarget.lease.id,
            paidByTenantId: settlePayer || undefined,
            amount,
            month,
            year,
            status: 'paid',
            receivedDate: dueDate,
            paidDate: dueDate,
            paymentMethod: 'check',
            dueDate,
          },
          { deferSheetSync: i < rows.length - 1 }
        );
      }
      showToast(`Marked ${rows.length} month${rows.length === 1 ? '' : 's'} paid (${formatCurrency(settleTotal)}).`, 'success');
      closeSettleModal();
    } catch (err) {
      showToast((err as Error).message || 'Could not settle the back rent', 'error');
    } finally {
      isSettlingRef.current = false;
      setIsSettling(false);
    }
  };

  const handleImport = async () => {
    if (isImportingRef.current) return;

    const lines = importData.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      showToast('Nothing to import. Paste CSV rows (with a header row).', 'error');
      return;
    }

    // Map columns by header name so column order is flexible. Normalize
    // headers (lowercase, strip spaces/underscores) so both the Export
    // format ("Due Date") and a hand-written one ("due_date") work.
    const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, '');
    const headers = parseCsvLine(lines[0]).map(norm);
    const col = (...aliases: string[]) => headers.findIndex(h => aliases.includes(h));
    const iTenant = col('tenant', 'tenantname', 'occupant', 'occupants', 'paidby');
    const iProperty = col('property', 'propertyname');
    const iUnit = col('unit', 'unitnumber');
    const iMonth = col('month');
    const iYear = col('year');
    const iDue = col('duedate', 'due');
    const iPaid = col('paiddate');
    const iAmount = col('amount', 'paid');
    const iStatus = col('status');

    if (iAmount === -1) {
      showToast('CSV needs an "Amount" (or "Paid") column. Try exporting first to see the format.', 'error');
      return;
    }

    // Only 'paid' counts as money received (see paymentsForMonth), so an
    // imported status has to say one thing: did the money arrive? A 'partial'
    // row means it did, and the amount is what makes the month partial, so it
    // maps to 'paid' and settlement works the rest out. 'overdue' means it did
    // not, same as 'pending'. Importing those two verbatim would file real
    // money under a status nothing counts, and it would vanish from every page.
    const importedStatus = (raw: string): RentPayment['status'] => {
      if (raw === 'pending' || raw === 'overdue') return 'pending';
      return 'paid';
    };
    let imported = 0;
    let skippedInvalid = 0;
    let skippedNoLease = 0;

    isImportingRef.current = true;
    setIsImporting(true);
    try {
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const amount = parseFloat((cells[iAmount] || '').replace(/[$,]/g, ''));
        if (isNaN(amount)) { skippedInvalid++; continue; }

        const propertyName = iProperty >= 0 ? (cells[iProperty] || '').trim().toLowerCase() : '';
        const unitNumber = iUnit >= 0 ? (cells[iUnit] || '').trim().toLowerCase() : '';
        const property = properties.find(p => p.name.trim().toLowerCase() === propertyName);
        const unit = units.find(
          u => (u.unitNumber || '').trim().toLowerCase() === unitNumber &&
            (!property || u.propertyId === property.id)
        );

        // A unit with no ACTIVE lease has no one to bill: skip it rather
        // than creating an orphaned payment against a unit that's vacant,
        // paused, or between tenants. Paused leases are deliberately
        // excluded here, they never appear as a row on this page.
        const lease = unit ? activeLeases(leases).find(l => l.unitId === unit.id) : undefined;
        if (!lease) { skippedNoLease++; continue; }

        const tenantCell = iTenant >= 0 ? (cells[iTenant] || '').trim() : '';
        const matchedTenant = matchSinglePayer(tenantCell, getLeaseTenants(lease.id));

        const monthStr = iMonth >= 0 ? (cells[iMonth] || '').trim() : '';
        let month = MONTHS.findIndex(m => m.toLowerCase() === monthStr.toLowerCase()) + 1;
        if (month === 0) month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);
        const year = (iYear >= 0 && parseInt(cells[iYear], 10)) || new Date().getFullYear();

        const rawStatus = (iStatus >= 0 ? cells[iStatus] || '' : '').trim().toLowerCase();
        const status = importedStatus(rawStatus);
        const paidDate = iPaid >= 0 ? (cells[iPaid] || '').trim() : '';

        await addRentPayment({
          leaseId: lease.id,
          paidByTenantId: matchedTenant?.id,
          amount,
          dueDate: (iDue >= 0 ? (cells[iDue] || '').trim() : '') || undefined,
          paidDate: paidDate || undefined,
          receivedDate: paidDate || undefined,
          status,
          month,
          year,
        }, { deferSheetSync: true });
        imported++;
      }

      // One master-spreadsheet rebuild for the whole import, instead of one
      // per row. Best-effort: a Drive/Sheets hiccup must not fail the import
      // (the database is the source of truth and the next change reconciles).
      if (imported > 0) {
        rentSheetApi.sync().catch(() => {});
      }

      const skipped = skippedInvalid + skippedNoLease;
      if (imported > 0) {
        const parts: string[] = [];
        if (skippedInvalid) parts.push(`${skippedInvalid} invalid row${skippedInvalid === 1 ? '' : 's'}`);
        if (skippedNoLease) parts.push(`${skippedNoLease} row${skippedNoLease === 1 ? '' : 's'} with no active lease for the unit`);
        showToast(
          `Imported ${imported} payment${imported === 1 ? '' : 's'}${skipped ? `, skipped ${parts.join(' and ')}` : ''}.`,
          'success'
        );
        setIsImportModalOpen(false);
        setImportData('');
      } else if (skippedNoLease > 0) {
        showToast(`No rows imported. ${skippedNoLease} row${skippedNoLease === 1 ? '' : 's'} had no active lease for the unit.`, 'error');
      } else {
        showToast('No valid rows found to import. Check the Amount column.', 'error');
      }
    } catch {
      showToast('Import failed partway through. Please check the CSV and try again.', 'error');
    } finally {
      isImportingRef.current = false;
      setIsImporting(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Property', 'Unit', 'Occupants', 'Month', 'Year', 'Due', 'Paid', 'Balance', 'Status'];
    const rows = filteredRows.map(row => [
      row.property?.name || '',
      row.unit?.unitNumber || '',
      row.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', '),
      MONTHS[row.month - 1],
      row.year,
      row.settlement.due,
      row.settlement.paid,
      row.settlement.balance,
      row.settlement.status,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(csvField).join(','))].join('\n');
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
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Rent Management</h1>
          <p className="text-muted mt-1 text-sm">Track rent payments and outstanding balances, by lease.</p>
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
        </div>
      </div>

      {/* Needs review: draft leases a realtor placed, not yet finalized. These
          owe no rent, so they never appear in the table below. */}
      {draftLeases.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-ink">Needs review</h2>
              <p className="text-sm text-muted mt-1">
                These tenancies were placed by a realtor. Set the dates and rent to finalize them.
              </p>
            </div>
            <div className="space-y-2">
              {draftLeases.map(lease => {
                const tenants = getLeaseTenants(lease.id);
                const tenantNames = tenants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                const unit = units.find(u => u.id === lease.unitId);
                const property = properties.find(p => p.id === lease.propertyId);
                const location = [unit ? `Unit ${unit.unitNumber}` : null, property?.address].filter(Boolean).join(', ');
                const firstTenantId = tenants[0]?.id;

                return (
                  <div
                    key={lease.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-line p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="warning">Needs review</Badge>
                      <div>
                        <div className="text-sm font-medium text-ink">{tenantNames}</div>
                        {location && <div className="text-sm text-muted">{location}</div>}
                      </div>
                    </div>
                    {firstTenantId && (
                      <Link
                        to={`/tenants/${firstTenantId}`}
                        className="inline-flex items-center justify-center rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-black/[0.02] w-fit"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* View Toggle */}
      <div className="flex gap-2 border-b border-line overflow-x-auto">
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'payments'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-ink'
          }`}
          onClick={() => setView('payments')}
        >
          Payments
        </button>
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'annual'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-ink'
          }`}
          onClick={() => setView('annual')}
        >
          Annual Overview
        </button>
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'tax'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-ink'
          }`}
          onClick={() => setView('tax')}
        >
          Tax Report
        </button>
      </div>

      {/* Year Filter */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-ink">Year:</label>
        <select
          className="px-4 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
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
          <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
            {statCards.map(s => (
              <Card key={s.label}>
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">{s.label}</span>
                    <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]">{s.icon}</span>
                  </div>
                  <div className={`mt-3 font-display text-[27px] leading-none font-medium tnum ${s.valueClass}`}>{s.value}</div>
                </div>
              </Card>
            ))}
          </div>

          {/* Move-in fees: a one-time obligation per lease, collected here. */}
          {(() => {
            const mifLeases = leases
              .filter(l => l.status !== 'ended' && (l.securityDeposit || 0) > 0)
              .sort((a, b) => Number(!!a.moveInFeePaid) - Number(!!b.moveInFeePaid));
            if (mifLeases.length === 0) return null;
            const owedCount = mifLeases.filter(l => !l.moveInFeePaid).length;
            return (
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-ink flex items-center gap-2"><Wallet className="h-4 w-4 text-faint" /> Move-in fees</h3>
                    {owedCount > 0 && <Badge variant="warning">{owedCount} owed</Badge>}
                  </div>
                  <div className="divide-y divide-line">
                    {mifLeases.map(l => {
                      const occ = getLeaseTenants(l.id);
                      const names = occ.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                      const prop = properties.find(p => p.id === l.propertyId);
                      const unit = units.find(u => u.id === l.unitId);
                      return (
                        <div key={l.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-ink truncate">{names}</p>
                            <p className="text-xs text-muted truncate">{prop?.name || '—'}{unit ? ` · Unit ${unit.unitNumber}` : ''}</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="font-semibold text-ink tnum">{formatCurrency(l.securityDeposit || 0)}</span>
                            {l.moveInFeePaid ? (
                              <div className="flex items-center gap-2">
                                <Badge variant="success">Paid{l.moveInFeePaidDate ? ` ${formatDate(l.moveInFeePaidDate)}` : ''}</Badge>
                                {l.moveInFeeReceiptDocumentId && (
                                  <a href={documentsApi.downloadUrl(l.moveInFeeReceiptDocumentId)} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Receipt</a>
                                )}
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => openMoveInFee(l)}>Record payment</Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Search */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
              <input
                type="text"
                placeholder="Search by unit, property, or occupant..."
                className="w-full pl-10 pr-4 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Payments list: one collapsible row per tenant, whoever owes on top */}
          <Card>
            <CardContent className="p-0">
              {tenantGroups.map(group => {
                const head = group.monthRows[0];
                const occupants = head?.occupants ?? [];
                const names = occupants.length
                  ? occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ')
                  : '—';
                const location = [head?.property?.name, head?.unit ? `Unit ${head.unit.unitNumber}` : null]
                  .filter(Boolean).join(' · ') || '—';
                const isExpanded = expandedLeaseIds.has(group.lease.id);
                const thisStatus = group.thisMonth ? settlementStatusConfig[group.thisMonth.settlement.status] : null;
                const ThisIcon = thisStatus?.icon;
                const monthAbbr = group.thisMonth ? (MONTHS[group.thisMonth.month - 1] ?? '').slice(0, 3) : '';
                const canRecordThisMonth = group.thisMonth && group.thisMonth.settlement.status !== 'paid';

                return (
                  <div
                    key={group.lease.id}
                    className={`border-b border-line last:border-0 ${group.needsAttention ? '' : 'opacity-60'}`}
                  >
                    {/* Collapsed summary row */}
                    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-black/[0.02]">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(group.lease.id)}
                        aria-expanded={isExpanded}
                        className="flex flex-1 items-center gap-3 text-left min-w-0"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-faint flex-shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink truncate">{names}</div>
                          <div className="text-sm text-muted truncate">{location}</div>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {group.overdue > 0 && (
                          <Badge variant="destructive" className="whitespace-nowrap">
                            {formatCurrency(group.overdue)} overdue
                          </Badge>
                        )}
                        {thisStatus && ThisIcon && (
                          <Badge variant={thisStatus.color} className="hidden sm:inline-flex items-center gap-1 whitespace-nowrap">
                            <ThisIcon className="h-3 w-3" />
                            {monthAbbr} {thisStatus.label}
                          </Badge>
                        )}
                        {!group.needsAttention && !thisStatus && (
                          isFutureYear
                            ? <Badge variant="secondary" className="whitespace-nowrap">Upcoming</Badge>
                            : <Badge variant="success" className="whitespace-nowrap">All paid</Badge>
                        )}
                        {canRecordThisMonth && (
                          <Button size="sm" variant="outline" onClick={() => openRecordModal(group.thisMonth!)}>
                            Record
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Expanded month-by-month detail for this one tenant */}
                    {isExpanded && (
                      <div className="bg-canvas px-4 sm:px-6 pb-2">
                        {group.monthRows.map(mr => {
                          const s = settlementStatusConfig[mr.settlement.status];
                          const SIcon = s.icon;
                          // The most recent date rent was received for this month, so the
                          // owner sees WHEN each month's payment was tracked.
                          const receivedOn = rentPayments
                            .filter(pm => pm.leaseId === mr.lease.id && pm.month === mr.month && pm.year === mr.year && pm.status === 'paid')
                            .map(pm => pm.paidDate || pm.receivedDate || '')
                            .filter(Boolean)
                            .sort()
                            .at(-1);
                          return (
                            <div
                              key={`${mr.month}`}
                              className="flex items-center gap-3 py-2.5 border-b border-line last:border-0"
                            >
                              <span className="text-sm text-ink w-24 sm:w-28 flex-shrink-0">
                                {formatMonthYear(mr.month, mr.year)}
                              </span>
                              <span className="text-sm text-muted tnum flex-1 truncate">
                                {formatCurrency(mr.settlement.due)} due · {formatCurrency(mr.settlement.paid)} paid
                                {receivedOn ? ` · received ${formatDate(receivedOn)}` : ''}
                              </span>
                              {mr.settlement.balance > 0 && (
                                <span className="hidden sm:inline text-sm font-semibold text-danger tnum">
                                  {formatCurrency(mr.settlement.balance)}
                                </span>
                              )}
                              {mr.settlement.status === 'paid' ? (
                                <Badge variant={s.color} className="flex items-center gap-1 flex-shrink-0">
                                  <SIcon className="h-3 w-3" />
                                  {s.label}
                                </Badge>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => openRecordModal(mr)} className="flex-shrink-0">
                                  Record
                                </Button>
                              )}
                              {isSuperAdmin() && mr.settlement.paid > 0 && (
                                <button
                                  onClick={() => handleDeleteRent(mr)}
                                  disabled={deletingRow === `${mr.lease.id}-${mr.month}-${mr.year}`}
                                  title="Delete this recorded rent"
                                  className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors flex-shrink-0 disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {isSuperAdmin() && (
                          <div className="flex justify-end pt-2 pb-1">
                            <button
                              type="button"
                              onClick={() => openSettleModal(group.lease, names, occupants)}
                              className="text-xs text-muted hover:text-ink underline underline-offset-2"
                              title="For a tenant who started earlier and is already paid up: record every owed month up to a date as paid, in one step."
                            >
                              Mark rent paid through…
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {tenantGroups.length === 0 && (
                <div className="text-center py-16">
                  <DollarSign className="h-10 w-10 mx-auto text-faint mb-3" />
                  <h3 className="font-medium text-ink">No rent rows found</h3>
                  <p className="text-sm text-muted mt-1">Try adjusting your search or the year filter.</p>
                </div>
              )}
            </CardContent>
          </Card>
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
                <p className="text-xs text-muted">Total rent expected</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Annual Collected</CardTitle>
                <TrendingUp className="h-4 w-4 text-positive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-positive">{formatCurrency(annualData.reduce((s, m) => s + m.collected, 0))}</div>
                <p className="text-xs text-muted">Total rent collected</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Annual Outstanding</CardTitle>
                <TrendingDown className="h-4 w-4 text-danger" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-danger">{formatCurrency(annualData.reduce((s, m) => s + m.outstanding, 0))}</div>
                <p className="text-xs text-muted">Unpaid rent</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Collection Rate</CardTitle>
                <DollarSign className="h-4 w-4 text-muted" />
              </CardHeader>
              <CardContent>
                {/* Collected over expected for months that have actually begun,
                    the same figure the Payments tab shows. The old "average of
                    12 monthly rates" counted not-yet-due future months as 0%
                    and read far below reality mid-year. */}
                <div className="text-2xl font-bold">{yearStats.collectionRate.toFixed(1)}%</div>
                <p className="text-xs text-muted">Collected of expected, months elapsed</p>
              </CardContent>
            </Card>
          </div>

          {/* Annual Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Annual Rent Collection for {yearFilter}</CardTitle>
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
                  <Bar dataKey="outstanding" fill="#ef4444" name="Outstanding" />
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
                    <tr className="border-b bg-canvas">
                      <th className="text-left py-3 px-4 font-medium">Month</th>
                      <th className="text-right py-3 px-4 font-medium">Expected</th>
                      <th className="text-right py-3 px-4 font-medium">Collected</th>
                      <th className="text-right py-3 px-4 font-medium">Outstanding</th>
                      <th className="text-right py-3 px-4 font-medium">Collection Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annualData.map((month) => (
                      <tr key={month.month} className="border-b last:border-0 hover:bg-black/[0.02]">
                        <td className="py-3 px-4 font-medium">{MONTHS[month.month - 1]}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(month.expected)}</td>
                        <td className="py-3 px-4 text-right text-positive">{formatCurrency(month.collected)}</td>
                        <td className="py-3 px-4 text-right text-danger">{formatCurrency(month.outstanding)}</td>
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
                <TrendingUp className="h-4 w-4 text-positive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-positive">{formatCurrency(taxData.totalRentIncome)}</div>
                <p className="text-xs text-muted">Taxable income</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expected</CardTitle>
                <Calendar className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(taxData.totalExpected)}</div>
                <p className="text-xs text-muted">Full year potential</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
                <AlertCircle className="h-4 w-4 text-danger" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-danger">{formatCurrency(taxData.totalOutstanding)}</div>
                <p className="text-xs text-muted">Uncollected rent</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Collection Rate</CardTitle>
                <Clock className="h-4 w-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {taxData.totalExpected > 0 ? ((taxData.totalRentIncome / taxData.totalExpected) * 100).toFixed(1) : '0.0'}%
                </div>
                <p className="text-xs text-muted">Collected of expected</p>
              </CardContent>
            </Card>
          </div>

          {/* Quarterly Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Quarterly Summary for Tax Filing, {yearFilter}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-canvas">
                      <th className="text-left py-3 px-4 font-medium">Quarter</th>
                      <th className="text-right py-3 px-4 font-medium">Expected Rent</th>
                      <th className="text-right py-3 px-4 font-medium">Collected Rent</th>
                      <th className="text-right py-3 px-4 font-medium">Outstanding</th>
                      <th className="text-right py-3 px-4 font-medium">Collection Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxData.quarterlyData.map((q) => (
                      <tr key={q.name} className="border-b last:border-0 hover:bg-black/[0.02]">
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
                  <ul className="space-y-1 text-sm text-muted">
                    <li className="flex justify-between">
                      <span>Rent payments received</span>
                      <span className="font-medium text-ink">{formatCurrency(taxData.totalRentIncome)}</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Late fees</span>
                      <span className="font-medium text-ink">$0.00</span>
                    </li>
                    <li className="flex justify-between border-t pt-1">
                      <span className="font-semibold">Total Taxable Income</span>
                      <span className="font-bold text-ink">{formatCurrency(taxData.totalRentIncome)}</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="font-semibold">Common Deductions</h4>
                  <ul className="space-y-1 text-sm text-muted">
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
        onClose={isImporting ? () => {} : () => { setIsImportModalOpen(false); setImportData(''); }}
        title="Import Rent Payments"
        size="lg"
      >
        <div className="space-y-4">
          <div className="bg-primary-soft border border-primary-line rounded-lg p-4">
            <h4 className="font-semibold text-primary mb-2">CSV Format</h4>
            <p className="text-sm text-primary-hover mb-2">
              Upload a CSV file with the following columns. The unit must have an active
              tenancy, rows for a vacant or ended unit are skipped. Tenant name is
              optional: if it matches someone on the lease, that person is recorded
              as who paid.
            </p>
            <code className="text-xs bg-primary-soft px-2 py-1 rounded block">
              property,unit,tenant_name,amount,month,year
            </code>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-ink">Paste CSV Data</label>
            <textarea
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              rows={10}
              placeholder="property,unit,tenant_name,amount,month,year&#10;Sunset Apartments,101,John Doe,2800,1,2026"
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 font-mono text-sm"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => { setIsImportModalOpen(false); setImportData(''); }}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button onClick={handleImport} className="flex-1" disabled={isImporting}>
              {isImporting ? 'Importing...' : 'Import Data'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        isOpen={!!recordRow}
        onClose={isRecording ? () => {} : closeRecordModal}
        title="Record Payment"
        size="md"
      >
        {recordRow && (
          <div className="space-y-4">
            <div className="bg-primary-soft border border-primary-line rounded-lg p-4">
              <h4 className="font-semibold text-primary mb-1">
                {recordRow.property?.name || 'Unit'}{recordRow.unit ? `, Unit ${recordRow.unit.unitNumber}` : ''}
              </h4>
              <div className="text-sm text-primary-hover space-y-1">
                <p>
                  <span className="font-medium">Period:</span>{' '}
                  {formatMonthYear(recordRow.month, recordRow.year)}
                </p>
                <p>
                  <span className="font-medium">Due:</span>{' '}
                  {formatCurrency(recordRow.settlement.due)}
                </p>
                <p>
                  <span className="font-medium">Paid so far:</span>{' '}
                  {formatCurrency(recordRow.settlement.paid)}
                </p>
                <p>
                  <span className="font-medium">Balance:</span>{' '}
                  {formatCurrency(recordRow.settlement.balance)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={recordForm.amount}
                  onChange={(e) => setRecordForm({ ...recordForm, amount: e.target.value })}
                  className="w-full pl-8 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Who Paid</label>
              <select
                value={recordForm.paidByTenantId}
                onChange={(e) => setRecordForm({ ...recordForm, paidByTenantId: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">Not specified</option>
                {recordRow.occupants.map(t => (
                  <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Date Received *</label>
              <input
                type="date"
                value={recordForm.receivedDate}
                onChange={(e) => setRecordForm({ ...recordForm, receivedDate: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Payment Method *</label>
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

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">Notes</label>
              <textarea
                rows={2}
                value={recordForm.notes}
                onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })}
                placeholder="Optional note about this payment (e.g. partial, paid in cash to office)"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">Proof of payment</label>
              <input
                ref={proofInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-primary/50"
              />
              <p className="text-xs text-muted">
                {proofFile
                  ? `Selected: ${proofFile.name}. Kept for your records only, not shown to the tenant.`
                  : "Optional. A receipt or screenshot for your records. This stays private to the office and is not shown to the tenant."}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeRecordModal}
                disabled={isRecording}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleRecordPayment}
                disabled={isRecording}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {isRecording ? 'Saving...' : 'Record Payment'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Mark rent paid through … (backdated-tenant onboarding) */}
      <Modal
        isOpen={!!settleTarget}
        onClose={isSettling ? () => {} : closeSettleModal}
        title="Mark rent paid"
        size="md"
      >
        {settleTarget && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Record every owed month for <span className="font-medium text-ink">{settleTarget.names}</span> as paid, from the
              lease start through the month you choose. Use this when a tenant who started earlier is already paid up. Months
              already paid are left alone.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Paid through *</label>
              <input
                type="month"
                value={settleThrough}
                onChange={(e) => setSettleThrough(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {settleTarget.occupants.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Who paid (optional)</label>
                <select
                  value={settlePayer}
                  onChange={(e) => setSettlePayer(e.target.value)}
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  <option value="">Not specified</option>
                  {settleTarget.occupants.map((t) => (
                    <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="bg-primary-soft border border-primary-line rounded-lg p-4 text-sm">
              {settlePreview.length === 0 ? (
                <p className="text-muted">Nothing owed to settle for that period. Everything up to then is already paid.</p>
              ) : (
                <p className="text-ink">
                  This records{' '}
                  <span className="font-semibold">{settlePreview.length} month{settlePreview.length === 1 ? '' : 's'}</span>{' '}
                  ({formatMonthYear(settlePreview[0].month, settlePreview[0].year)} through{' '}
                  {formatMonthYear(settlePreview[settlePreview.length - 1].month, settlePreview[settlePreview.length - 1].year)}){' '}
                  as paid, totaling <span className="font-semibold">{formatCurrency(settleTotal)}</span>.
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={closeSettleModal} disabled={isSettling}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSettleBackRent}
                disabled={isSettling || settlePreview.length === 0}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {isSettling ? 'Recording…' : `Mark ${settlePreview.length} paid`}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Record move-in fee */}
      <Modal isOpen={!!mifLease} onClose={() => setMifLease(null)} title="Record move-in fee" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Record the non-refundable move-in fee as paid. This logs it as income and emails the tenant a receipt.
          </p>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input
                type="number" min="0" step="0.01"
                value={mifForm.amount}
                onChange={(e) => setMifForm({ ...mifForm, amount: e.target.value })}
                className="w-full pl-8 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Date paid</label>
            <input
              type="date"
              value={mifForm.date}
              onChange={(e) => setMifForm({ ...mifForm, date: e.target.value })}
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Payment method</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(paymentMethodConfig) as PaymentMethod[]).map((method) => {
                const cfg = paymentMethodConfig[method];
                const Icon = cfg.icon;
                const on = mifForm.method === method;
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setMifForm({ ...mifForm, method })}
                    className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${on ? 'border-primary bg-primary-soft text-primary font-medium' : 'border-line text-muted hover:text-ink'}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMifLease(null)}>Cancel</Button>
            <Button onClick={submitMoveInFee} disabled={mifBusy}>{mifBusy ? 'Recording...' : 'Record payment'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
