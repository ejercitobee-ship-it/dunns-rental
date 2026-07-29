import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, User, Edit2, Home, DoorOpen, Calendar, DollarSign,
  FileText, Upload, Download, Trash2, Users, ShieldAlert, KeyRound, Briefcase, Check,
  Pause, Play, LogOut, MessageSquare, Send,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate, formatMonthYear, todayLocalDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  documentsApi, tenantsApi, householdApi, photoApi, paymentsApi, messagesApi,
  type AppDocument, type TenantRealtorLink, type RealtorUserOption, type HouseholdMember, type Message,
} from '../lib/api';
import { resizeImage } from '../lib/image';
import { leasesOwingMonth, settleMonth, unsettledMonths } from '../lib/rent';
import type { LeaseStatus, PaymentMethod } from '../types';

const leaseStatusBadge: Record<LeaseStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  ended: 'secondary',
};

const leaseStatusLabel: Record<LeaseStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

const settlementBadge = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive',
} as const;

function formatMethod(method?: PaymentMethod): string {
  if (!method) return '—';
  return method
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    tenants, properties, units, rentPayments,
    updateTenant, deleteTenant, updateLease, getLeaseTenants, getTenantLeases,
  } = useApp();
  const { user, hasPermission } = useAuth();
  const { showToast } = useToast();

  const tenant = tenants.find(t => t.id === id);
  const canManagePortal = hasPermission('tenants_edit');

  // The tenant's photo as loaded from context (tenant.photoUrl) can go stale
  // right after an upload/remove until the next context refresh, so a local
  // override (undefined = "no override, use tenant.photoUrl") takes
  // precedence for the avatar shown on this page.
  const [photoOverride, setPhotoOverride] = useState<string | null | undefined>(undefined);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const displayedPhotoUrl = photoOverride !== undefined ? photoOverride : (tenant?.photoUrl ?? null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
    emergencyName: '',
    emergencyPhone: '',
    emergencyRelationship: '',
  });
  const [docs, setDocs] = useState<AppDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Portal access: who is invited, and which realtors are linked. Only
  // fetched when this viewer can act on it, since the endpoints require
  // tenants_edit and would otherwise just 403.
  const [realtors, setRealtors] = useState<TenantRealtorLink[]>([]);
  const [realtorOptions, setRealtorOptions] = useState<RealtorUserOption[]>([]);
  const [realtorsLoading, setRealtorsLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [resettingPw, setResettingPw] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  // Receipt ids generated in this session, so a freshly created receipt links
  // immediately without a full payments refetch (they overlay p.receiptDocumentId).
  const [receiptIds, setReceiptIds] = useState<Record<string, string>>({});
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState('');
  const [linking, setLinking] = useState(false);
  const [removingRealtorId, setRemovingRealtorId] = useState<string | null>(null);

  // Household: the people living with this tenant. Loaded regardless of
  // permission so a view-only admin still sees the roster; the add/edit/
  // remove controls are gated on canManagePortal below.
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [householdForm, setHouseholdForm] = useState({ name: '', phone: '', relationship: '' });
  const [editingHouseholdId, setEditingHouseholdId] = useState<string | null>(null);
  const [householdToRemove, setHouseholdToRemove] = useState<HouseholdMember | null>(null);
  const [householdBusy, setHouseholdBusy] = useState(false);
  const [tenantToDelete, setTenantToDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    documentsApi.list(id).then(setDocs).catch(() => setDocs([]));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    householdApi.list(id).then(setHouseholdMembers).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id || !canManagePortal) return;
    let cancelled = false;
    // Flip to loading before this fetch; the async result clears it in finally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtorsLoading(true);
    // The realtor-role users come from /api/realtors (gated on tenants_edit),
    // not the full users list, so the picker is populated for any staff member
    // who can link a realtor, not only those who also hold users_view.
    Promise.all([tenantsApi.getRealtors(id), tenantsApi.listRealtorUsers()])
      .then(([links, options]) => {
        if (cancelled) return;
        setRealtors(links);
        setRealtorOptions(options);
      })
      .catch(() => {
        if (cancelled) return;
        setRealtors([]);
        setRealtorOptions([]);
      })
      .finally(() => {
        if (!cancelled) setRealtorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, canManagePortal]);

  const lease = useMemo(() => {
    if (!id) return undefined;
    return getTenantLeases(id).find(l => l.status !== 'ended');
  }, [id, getTenantLeases]);

  // The most recent ENDED tenancy, shown only when there is no current one, so a
  // terminated tenant still displays when and why they left.
  const endedLease = useMemo(() => {
    if (!id) return null;
    return getTenantLeases(id)
      .filter(l => l.status === 'ended')
      .sort((a, b) => (b.endDate || b.startDate || '').localeCompare(a.endDate || a.startDate || ''))[0] ?? null;
  }, [id, getTenantLeases]);

  const housemates = useMemo(() => {
    if (!lease || !id) return [];
    return getLeaseTenants(lease.id).filter(h => h.id !== id);
  }, [lease, id, getLeaseTenants]);

  const property = lease?.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
  const unit = lease?.unitId ? units.find(u => u.id === lease.unitId) : undefined;

  // Former-tenancy place: prefer the snapshot taken at termination, falling back
  // to a live lookup (for tenancies ended before the snapshot existed).
  const endedProp = endedLease?.propertyId ? properties.find(p => p.id === endedLease.propertyId) : undefined;
  const endedUnitRow = endedLease?.unitId ? units.find(u => u.id === endedLease.unitId) : undefined;
  const endedPropLabel = endedLease?.endedPropertyLabel || endedProp?.name || endedProp?.address;
  const endedUnitLabel = endedLease?.endedUnitLabel || (endedUnitRow ? `Unit ${endedUnitRow.unitNumber}` : undefined);

  const thisMonth = useMemo(() => {
    if (!lease) return undefined;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    // Gated the same way every other page gates a month against a lease:
    // leasesOwingMonth already knows a lease starting in the future owes
    // nothing yet, and that a paused lease stops owing from its pause month
    // on. Showing a settlement without this would invent a balance the
    // owner never billed.
    if (!leasesOwingMonth([lease], month, year).length) return undefined;
    return settleMonth(lease, rentPayments, month, year);
  }, [lease, rentPayments]);

  // Every month this tenancy still owes (oldest first), with the amount, so the
  // profile shows exactly which months are behind, not just a total.
  const owed = useMemo(() => {
    if (!lease) return { months: [] as { month: number; year: number; amount: number }[], total: 0 };
    const now = new Date();
    const months = unsettledMonths(lease, rentPayments, now.getMonth() + 1, now.getFullYear());
    const total = Math.round(months.reduce((s, m) => s + m.amount, 0) * 100) / 100;
    return { months, total };
  }, [lease, rentPayments]);

  const payments = useMemo(() => {
    if (!id) return [];
    // Rent lives on the LEASE, not the payer: a payment recorded without a
    // "who paid" (the common case) has a null paidByTenantId, so filtering by
    // payer showed nothing here even though the tenant portal (which scopes by
    // lease) showed the same payments. Match that: every payment on any lease
    // this person is on.
    const leaseIds = new Set(getTenantLeases(id).map(l => l.id));
    return rentPayments
      .filter(p => leaseIds.has(p.leaseId))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
  }, [rentPayments, id, getTenantLeases]);

  const openEdit = () => {
    if (!tenant) return;
    setForm({
      firstName: tenant.firstName,
      lastName: tenant.lastName,
      email: tenant.email || '',
      phone: tenant.phone || '',
      notes: tenant.notes || '',
      emergencyName: tenant.emergencyContact?.name || '',
      emergencyPhone: tenant.emergencyContact?.phone || '',
      emergencyRelationship: tenant.emergencyContact?.relationship || '',
    });
    setIsEditOpen(true);
  };

  const markMoveInFeePaid = async () => {
    if (!lease) return;
    try {
      await updateLease({ ...lease, moveInFeePaid: true });
      showToast('Move-in fee marked as paid.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update the move-in fee.', 'error');
    }
  };

  // Pause or resume rent collection on the current tenancy. The server stamps
  // the pause/resume interval from statusChangedOn, so today is the day sent.
  const handlePauseResume = async () => {
    if (!lease) return;
    const resuming = lease.status === 'paused';
    if (!confirm(resuming ? 'Resume rent for this tenancy?' : 'Pause rent for this tenancy? You can resume it later.')) return;
    try {
      await updateLease({ ...lease, status: resuming ? 'active' : 'paused', statusChangedOn: todayLocalDate() });
      showToast(resuming ? 'Rent resumed.' : 'Rent paused.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update the tenancy.', 'error');
    }
  };

  // Terminate the tenancy: records the move-out date and the reason, ends the
  // lease (so it stops billing from the following month), and frees the unit.
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [termForm, setTermForm] = useState({ date: todayLocalDate(), reason: '' });

  const handleTerminate = async () => {
    if (!lease || terminating) return;
    if (!termForm.date) {
      showToast('Enter the move-out date.', 'error');
      return;
    }
    setTerminating(true);
    try {
      await updateLease({
        ...lease,
        status: 'ended',
        endDate: termForm.date,
        endReason: termForm.reason.trim() || undefined,
        // Snapshot where they lived so the history is kept even if the unit is
        // later reassigned, renamed, or removed.
        endedPropertyLabel: property?.name || property?.address || undefined,
        endedUnitLabel: unit ? `Unit ${unit.unitNumber}` : undefined,
        statusChangedOn: termForm.date,
      });
      showToast('Tenancy terminated.', 'success');
      setTerminateOpen(false);
    } catch (err) {
      showToast((err as Error).message || 'Could not terminate the tenancy.', 'error');
    } finally {
      setTerminating(false);
    }
  };

  // Approving a realtor's draft placement: the office confirms the rent and
  // dates, then it becomes a live tenancy (needs_review cleared, so it starts
  // billing and shows Active). The unit was already occupied while pending.
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveForm, setApproveForm] = useState({ monthlyRent: '', startDate: '', endDate: '', moveInFee: '', moveInFeePaid: true });

  const openApprove = () => {
    if (!lease) return;
    setApproveForm({
      monthlyRent: lease.monthlyRent ? String(lease.monthlyRent) : '',
      startDate: lease.startDate || '',
      endDate: lease.endDate || '',
      moveInFee: lease.securityDeposit ? String(lease.securityDeposit) : '',
      moveInFeePaid: lease.moveInFeePaid !== false,
    });
    setApproveOpen(true);
  };

  const handleApprove = async () => {
    if (!lease || approving) return;
    const rent = Number(approveForm.monthlyRent);
    if (!Number.isFinite(rent) || rent <= 0) {
      showToast('Enter the monthly rent.', 'error');
      return;
    }
    if (!approveForm.startDate) {
      showToast('Enter the start date.', 'error');
      return;
    }
    setApproving(true);
    try {
      await updateLease({
        ...lease,
        monthlyRent: rent,
        startDate: approveForm.startDate,
        endDate: approveForm.endDate || undefined,
        securityDeposit: approveForm.moveInFee ? Number(approveForm.moveInFee) : 0,
        moveInFeePaid: approveForm.moveInFeePaid,
        needsReview: false,
      });
      showToast('Tenancy approved. It is now active.', 'success');
      setApproveOpen(false);
    } catch (err) {
      showToast((err as Error).message || 'Could not approve the tenancy.', 'error');
    } finally {
      setApproving(false);
    }
  };

  // Edit an existing tenancy's rent, dates, and move-in fee (the Tenancy card).
  const [tenancyOpen, setTenancyOpen] = useState(false);
  const [savingTenancy, setSavingTenancy] = useState(false);
  const [tenancyForm, setTenancyForm] = useState({ monthlyRent: '', startDate: '', endDate: '', moveInFee: '', moveInFeePaid: true });

  const openEditTenancy = () => {
    if (!lease) return;
    setTenancyForm({
      monthlyRent: lease.monthlyRent ? String(lease.monthlyRent) : '',
      startDate: lease.startDate || '',
      endDate: lease.endDate || '',
      moveInFee: lease.securityDeposit ? String(lease.securityDeposit) : '',
      moveInFeePaid: lease.moveInFeePaid !== false,
    });
    setTenancyOpen(true);
  };

  const handleSaveTenancy = async () => {
    if (!lease || savingTenancy) return;
    const rent = Number(tenancyForm.monthlyRent);
    if (!Number.isFinite(rent) || rent <= 0) {
      showToast('Enter the monthly rent.', 'error');
      return;
    }
    setSavingTenancy(true);
    try {
      await updateLease({
        ...lease,
        monthlyRent: rent,
        startDate: tenancyForm.startDate || undefined,
        endDate: tenancyForm.endDate || undefined,
        securityDeposit: tenancyForm.moveInFee ? Number(tenancyForm.moveInFee) : 0,
        moveInFeePaid: tenancyForm.moveInFeePaid,
      });
      showToast('Tenancy updated.', 'success');
      setTenancyOpen(false);
    } catch (err) {
      showToast((err as Error).message || 'Could not update the tenancy.', 'error');
    } finally {
      setSavingTenancy(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    try {
      const hasEmergencyContact =
        form.emergencyName.trim() || form.emergencyPhone.trim() || form.emergencyRelationship.trim();
      await updateTenant({
        ...tenant,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        notes: form.notes.trim() || undefined,
        emergencyContact: hasEmergencyContact
          ? {
              name: form.emergencyName.trim(),
              phone: form.emergencyPhone.trim(),
              relationship: form.emergencyRelationship.trim(),
            }
          : undefined,
      });
      showToast('Person updated', 'success');
      setIsEditOpen(false);
    } catch (err) {
      showToast((err as Error).message || 'Could not save changes', 'error');
    }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploadingDoc(true);
    try {
      await documentsApi.upload(file, { tenantId: id, propertyId: property?.id });
      setDocs(await documentsApi.list(id));
      showToast('Document uploaded', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Upload failed', 'error');
    } finally {
      setUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id || photoBusy) return;
    setPhotoBusy(true);
    try {
      const blob = await resizeImage(file);
      const { photoUrl } = await photoApi.uploadTenant(id, blob);
      setPhotoOverride(`${photoUrl}?t=${Date.now()}`);
      showToast('Photo updated.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update the photo.', 'error');
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handlePhotoRemove = async () => {
    if (!id || photoBusy) return;
    setPhotoBusy(true);
    try {
      await photoApi.removeTenant(id);
      setPhotoOverride(null);
      showToast('Photo removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove the photo.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await documentsApi.delete(docId);
      setDocs(prev => prev.filter(d => d.id !== docId));
      showToast('Document removed', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete', 'error');
    }
  };

  // There is no field that says a tenant already has a login: the invite
  // endpoint is the source of truth, and answers with a 400 ("This tenant
  // already has a login") when one exists. So the button is always shown,
  // and whatever the server says is passed straight through as the toast.
  const handleInvite = async () => {
    if (!id || inviting) return;
    setInviting(true);
    try {
      const result = await tenantsApi.invite(id);
      if (result.inviteUrl) setInviteUrl(result.inviteUrl);
      setInvited(true);
      // The account is always created; the email may not have gone out (an
      // unverified sending domain, say). Say which happened so Belle knows
      // whether she still needs to pass the link below on by hand.
      if (result.emailSent) {
        showToast(result.resent ? 'A fresh set-password link was sent.' : 'Invite email sent.', 'success');
      } else {
        showToast('Link ready, but the email could not be sent. Copy the link below and send it to the tenant.', 'info');
      }
    } catch (err) {
      showToast((err as Error).message || 'Could not send the invite', 'error');
    } finally {
      setInviting(false);
    }
  };

  // Like invite, the server is the source of truth on whether a login exists:
  // a tenant with none gets a 400 ("no portal login yet"), shown as the toast.
  const handleResetPassword = async () => {
    if (!id || resettingPw) return;
    setResettingPw(true);
    try {
      const result = await tenantsApi.resetPassword(id);
      setTempPassword(result.tempPassword);
      showToast('Temporary password generated. Share it with the tenant.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not reset the password', 'error');
    } finally {
      setResettingPw(false);
    }
  };

  const handleGenerateReceipt = async (paymentId: string) => {
    if (generatingReceipt) return;
    setGeneratingReceipt(paymentId);
    try {
      const { receiptDocumentId } = await paymentsApi.generateReceipt(paymentId);
      setReceiptIds(prev => ({ ...prev, [paymentId]: receiptDocumentId }));
      showToast('Receipt created.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not create the receipt', 'error');
    } finally {
      setGeneratingReceipt(null);
    }
  };

  const handleLinkRealtor = async () => {
    if (!id || !selectedRealtorId || linking) return;
    setLinking(true);
    try {
      await tenantsApi.linkRealtor(id, selectedRealtorId);
      setRealtors(await tenantsApi.getRealtors(id));
      setSelectedRealtorId('');
      showToast('Realtor linked', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not link that realtor', 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleRemoveRealtor = async (realtorUserId: string) => {
    if (!id || removingRealtorId) return;
    setRemovingRealtorId(realtorUserId);
    try {
      await tenantsApi.unlinkRealtor(id, realtorUserId);
      setRealtors(prev => prev.filter(r => r.realtorUserId !== realtorUserId));
      showToast('Realtor removed', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove that realtor', 'error');
    } finally {
      setRemovingRealtorId(null);
    }
  };

  const availableRealtors = realtorOptions.filter(
    u => !realtors.some(r => r.realtorUserId === u.id)
  );

  const resetHouseholdForm = () => {
    setHouseholdForm({ name: '', phone: '', relationship: '' });
    setEditingHouseholdId(null);
  };

  const submitHousehold = async () => {
    if (!id || !householdForm.name.trim() || householdBusy) return;
    setHouseholdBusy(true);
    try {
      if (editingHouseholdId) await householdApi.update(editingHouseholdId, householdForm);
      else await householdApi.add(id, householdForm);
      setHouseholdMembers(await householdApi.list(id));
      resetHouseholdForm();
      showToast('Saved.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save.', 'error');
    } finally {
      setHouseholdBusy(false);
    }
  };

  const handleDeleteTenant = async () => {
    if (!id) return;
    try {
      await deleteTenant(id);
      showToast('Tenant deleted', 'success');
      navigate('/tenants');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete this tenant', 'error');
    } finally {
      setTenantToDelete(false);
    }
  };

  const confirmRemoveHousehold = async () => {
    if (!householdToRemove) return;
    try {
      await householdApi.remove(householdToRemove.id);
      setHouseholdMembers(prev => prev.filter(m => m.id !== householdToRemove.id));
      if (editingHouseholdId === householdToRemove.id) resetHouseholdForm();
      showToast('Removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove.', 'error');
    } finally {
      setHouseholdToRemove(null);
    }
  };

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Link to="/tenants" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover">
          <ArrowLeft className="h-4 w-4" /> Back to Tenants
        </Link>
        <div className="text-center py-16">
          <User className="h-10 w-10 mx-auto text-faint mb-3" />
          <h3 className="font-medium text-ink">Person not found</h3>
          <p className="text-sm text-muted mt-1">This person may have been removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/tenants" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover">
        <ArrowLeft className="h-4 w-4" /> Back to Tenants
      </Link>

      {owed.months.length > 0 && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              Owes {formatCurrency(owed.total)} across {owed.months.length} {owed.months.length === 1 ? 'month' : 'months'}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {owed.months.map(m => (
                <span key={`${m.year}-${m.month}`} className="text-xs font-medium px-2 py-1 rounded-md bg-surface border border-danger/25 text-danger whitespace-nowrap">
                  {formatMonthYear(m.month, m.year)} · {formatCurrency(m.amount)}
                </span>
              ))}
            </div>
            <p className="text-sm text-muted mt-2">The full record is in Payment History below.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <Avatar
              photoUrl={displayedPhotoUrl}
              initials={`${tenant.firstName?.[0] ?? ''}${tenant.lastName?.[0] ?? ''}`}
              className="w-14 h-14 flex-shrink-0"
              initialsClassName="text-lg"
            />
            {canManagePortal && (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoPick}
                />
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => photoInputRef.current?.click()}
                  className="text-xs font-medium text-primary hover:text-primary-hover disabled:opacity-50"
                >
                  {displayedPhotoUrl ? 'Change photo' : 'Add photo'}
                </button>
                {displayedPhotoUrl && (
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={handlePhotoRemove}
                    className="text-xs font-medium text-muted hover:text-danger disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-medium text-ink leading-tight">
              {tenant.firstName} {tenant.lastName}
            </h1>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {lease ? (
                /* While a realtor's placement is under review it is not yet a
                   live tenancy, so it shows "Pending review", not "Active". */
                lease.needsReview ? (
                  <Badge variant="warning">Pending review</Badge>
                ) : (
                  <Badge variant={leaseStatusBadge[lease.status]}>{leaseStatusLabel[lease.status]}</Badge>
                )
              ) : (
                <Badge variant="outline">No tenancy</Badge>
              )}
              {/* Confirms the tenant has actually signed in to their portal. */}
              {tenant.verified && (
                <Badge variant="success" className="flex items-center gap-1">
                  <Check className="h-3 w-3" /> Verified
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {lease?.needsReview && canManagePortal && (
            <Button onClick={openApprove} className="flex-1 sm:flex-none">
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
          )}
          {canManagePortal && (
            <Button variant="outline" onClick={openEdit} className="flex-1 sm:flex-none">
              <Edit2 className="h-4 w-4 mr-2" />
              Edit Tenant
            </Button>
          )}
          {canManagePortal && lease && lease.status !== 'ended' && (
            <Button variant="outline" onClick={handlePauseResume} className="flex-1 sm:flex-none">
              {lease.status === 'paused' ? (
                <><Play className="h-4 w-4 mr-2" /> Resume rent</>
              ) : (
                <><Pause className="h-4 w-4 mr-2" /> Pause rent</>
              )}
            </Button>
          )}
          {canManagePortal && lease && lease.status !== 'ended' && (
            <Button variant="outline" onClick={() => { setTermForm({ date: todayLocalDate(), reason: '' }); setTerminateOpen(true); }} className="flex-1 sm:flex-none">
              <LogOut className="h-4 w-4 mr-2" />
              Terminate
            </Button>
          )}
          {hasPermission('tenants_delete') && (
            <Button
              variant="destructive"
              className="flex-1 sm:flex-none"
              onClick={() => setTenantToDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact & emergency contact */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <User className="h-4 w-4 text-faint" /> Contact
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted">
                <Mail className="h-3.5 w-3.5 text-faint" />
                <span className="truncate">{tenant.email || '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-muted">
                <Phone className="h-3.5 w-3.5 text-faint" />
                <span>{tenant.phone || '—'}</span>
              </div>
            </div>

            {tenant.notes && (
              <div className="pt-2 border-t border-line">
                <p className="eyebrow mb-1">Notes</p>
                <p className="text-sm text-muted">{tenant.notes}</p>
              </div>
            )}

            <div className="pt-2 border-t border-line">
              <p className="eyebrow mb-2 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" /> Emergency Contact
              </p>
              {tenant.emergencyContact ? (
                <div className="text-sm space-y-1">
                  <p className="text-ink font-medium">{tenant.emergencyContact.name}</p>
                  <p className="text-muted">{tenant.emergencyContact.phone}</p>
                  <p className="text-muted capitalize">{tenant.emergencyContact.relationship}</p>
                </div>
              ) : (
                <p className="text-sm text-faint">Not on file.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tenancy summary */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink flex items-center gap-2">
                <Home className="h-4 w-4 text-faint" /> Tenancy
              </h3>
              {lease && canManagePortal && (
                <button
                  type="button"
                  onClick={openEditTenancy}
                  className="text-sm font-medium text-primary hover:text-primary-hover inline-flex items-center gap-1"
                >
                  <Edit2 className="h-3.5 w-3.5" /> Edit
                </button>
              )}
            </div>
            {lease ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-ink">
                  <Home className="h-3.5 w-3.5 text-faint" />
                  <span>{property?.name || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <DoorOpen className="h-3.5 w-3.5 text-faint" />
                  <span>{unit ? `Unit ${unit.unitNumber}` : 'Unit no longer on file'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Calendar className="h-3.5 w-3.5 text-faint" />
                  <span>
                    {lease.startDate ? formatDate(lease.startDate) : '—'} to {lease.endDate ? formatDate(lease.endDate) : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-ink">
                  <DollarSign className="h-3.5 w-3.5 text-faint" />
                  <span className="font-semibold tnum">{formatCurrency(lease.monthlyRent)}</span>
                  <span className="text-muted">/month</span>
                </div>
                {(lease.securityDeposit ?? 0) > 0 && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
                    <span className="text-sm text-muted">Move-in fee {formatCurrency(lease.securityDeposit ?? 0)}</span>
                    {lease.moveInFeePaid === false ? (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="destructive">Owed</Badge>
                        {canManagePortal && (
                          <button onClick={markMoveInFeePaid} className="text-xs text-primary hover:underline">Mark paid</button>
                        )}
                      </div>
                    ) : (
                      <Badge variant="success">Paid</Badge>
                    )}
                  </div>
                )}
                {lease.status !== 'active' && (
                  <div className="pt-2 border-t border-line flex items-start justify-between gap-2">
                    <span className="eyebrow">Status</span>
                    <div className="text-right">
                      <Badge variant={lease.status === 'ended' ? 'secondary' : 'warning'}>
                        {leaseStatusLabel[lease.status]}
                      </Badge>
                      {lease.status === 'ended' && lease.endReason && (
                        <p className="text-xs text-muted mt-1 max-w-[190px]">{lease.endReason}</p>
                      )}
                    </div>
                  </div>
                )}
                {thisMonth && lease.status === 'active' && (
                  <div className="pt-2 border-t border-line flex items-center justify-between">
                    <span className="eyebrow">This Month</span>
                    <Badge variant={settlementBadge[thisMonth.status]} className="capitalize">{thisMonth.status}</Badge>
                  </div>
                )}
              </div>
            ) : endedLease ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Ended</Badge>
                  {endedLease.endDate && <span className="text-muted">Moved out {formatDate(endedLease.endDate)}</span>}
                </div>
                <div className="space-y-2 pt-2 border-t border-line">
                  <p className="eyebrow">Former tenancy</p>
                  <div className="flex items-center gap-2 text-ink">
                    <Home className="h-3.5 w-3.5 text-faint" />
                    <span>{endedPropLabel || 'Property not recorded'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <DoorOpen className="h-3.5 w-3.5 text-faint" />
                    <span>{endedUnitLabel || 'Unit not recorded'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <Calendar className="h-3.5 w-3.5 text-faint" />
                    <span>
                      {endedLease.startDate ? formatDate(endedLease.startDate) : '—'} to {endedLease.endDate ? formatDate(endedLease.endDate) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <DollarSign className="h-3.5 w-3.5 text-faint" />
                    <span>{formatCurrency(endedLease.monthlyRent)}<span className="text-faint">/month</span></span>
                  </div>
                </div>
                {endedLease.endReason && <p className="text-muted">Reason for leaving: {endedLease.endReason}</p>}
                <p className="text-xs text-faint">The unit is freed up. This record and payment history are kept.</p>
              </div>
            ) : (
              <p className="text-sm text-faint">No active or paused lease on file.</p>
            )}
          </CardContent>
        </Card>

        {/* Housemates */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <Users className="h-4 w-4 text-faint" /> Housemates
            </h3>
            {housemates.length > 0 ? (
              <div className="space-y-2">
                {housemates.map(h => (
                  <Link
                    key={h.id}
                    to={`/tenants/${h.id}`}
                    className="flex items-center gap-2.5 p-2 -mx-2 rounded-lg hover:bg-black/[0.03] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-primary">{h.firstName[0]}{h.lastName[0]}</span>
                    </div>
                    <span className="text-sm text-ink">{h.firstName} {h.lastName}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-faint">Lives alone on this lease.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Household */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <h3 className="font-semibold text-ink flex items-center gap-2">
            <Users className="h-4 w-4 text-faint" /> Household
          </h3>
          {!lease ? (
            <p className="text-sm text-faint">This tenant has no active lease, so there is no household to manage.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {householdMembers.map(m => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-ink font-medium text-sm">{m.name}</p>
                      <p className="text-muted text-xs">
                        {[m.relationship, m.phone].filter(Boolean).join(' · ') || 'No details on file'}
                      </p>
                    </div>
                    {canManagePortal && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingHouseholdId(m.id);
                            setHouseholdForm({ name: m.name, phone: m.phone ?? '', relationship: m.relationship ?? '' });
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setHouseholdToRemove(m)}>Remove</Button>
                      </div>
                    )}
                  </li>
                ))}
                {householdMembers.length === 0 && <li className="text-sm text-faint">No one added yet.</li>}
              </ul>
              {canManagePortal && (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      className="rounded-lg border border-line px-3 py-2 text-sm"
                      placeholder="Name"
                      value={householdForm.name}
                      onChange={(e) => setHouseholdForm({ ...householdForm, name: e.target.value })}
                    />
                    <input
                      className="rounded-lg border border-line px-3 py-2 text-sm"
                      placeholder="Relationship"
                      value={householdForm.relationship}
                      onChange={(e) => setHouseholdForm({ ...householdForm, relationship: e.target.value })}
                    />
                    <input
                      className="rounded-lg border border-line px-3 py-2 text-sm"
                      placeholder="Phone"
                      value={householdForm.phone}
                      onChange={(e) => setHouseholdForm({ ...householdForm, phone: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!householdForm.name.trim() || householdBusy}
                      onClick={submitHousehold}
                    >
                      {editingHouseholdId ? 'Save changes' : 'Add person'}
                    </Button>
                    {editingHouseholdId && (
                      <Button variant="outline" size="sm" onClick={resetHouseholdForm}>Cancel</Button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
        <ConfirmDialog
          isOpen={!!householdToRemove}
          onClose={() => setHouseholdToRemove(null)}
          onConfirm={confirmRemoveHousehold}
          title="Remove household member"
          message={`Remove ${householdToRemove?.name} from this household?`}
          confirmText="Remove"
        />
      </Card>

      {/* Documents */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <FileText className="h-4 w-4 text-faint" /> Documents
            </h3>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUploadDoc} />
            <button
              type="button"
              disabled={uploadingDoc}
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-medium text-primary hover:text-primary-hover flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {uploadingDoc ? 'Uploading...' : 'Upload'}
            </button>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-muted">No documents yet. Upload a lease, ID, or receipt.</p>
          ) : (
            <div className="space-y-1.5">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center justify-between px-3 py-2 border border-line rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-faint flex-shrink-0" />
                    <span className="text-sm text-ink truncate">{doc.name}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={documentsApi.downloadUrl(doc.id)}
                      className="p-1.5 text-faint hover:text-primary hover:bg-primary-soft rounded-md transition-colors"
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Portal access */}
      {canManagePortal && (
        <Card>
          <CardContent className="p-5 space-y-5">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-faint" /> Portal Access
            </h3>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm text-ink font-medium">Tenant login</p>
                <p className="text-xs text-muted mt-0.5">
                  Give this person their own sign in to the tenant portal, or reset it for them.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* A tenant who already has a login (or was just invited) can be
                    RE-sent a fresh set-password link — vital when the first one
                    expired. Otherwise it's a first invite. */}
                <Button variant="outline" size="sm" disabled={inviting} onClick={handleInvite}>
                  {inviting
                    ? 'Sending...'
                    : (tenant?.hasLogin || invited) ? 'Resend invite' : 'Invite to Portal'}
                </Button>
                <Button variant="outline" size="sm" disabled={resettingPw} onClick={handleResetPassword}>
                  {resettingPw ? 'Resetting...' : 'Reset Password'}
                </Button>
              </div>
            </div>

            {tempPassword && (
              <div className="px-3 py-2.5 bg-canvas border border-line rounded-lg space-y-1.5">
                <p className="text-xs text-muted">
                  Temporary password. Share it securely; the tenant must change it at next sign in.
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-ink break-all flex-1">{tempPassword}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(tempPassword);
                      showToast('Password copied', 'success');
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}

            {inviteUrl && (
              <div className="px-3 py-2.5 bg-canvas border border-line rounded-lg space-y-1.5">
                <p className="text-xs text-muted">
                  Email is not set up, so send this link to the tenant yourself.
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-ink break-all flex-1">{inviteUrl}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(inviteUrl);
                      showToast('Link copied', 'success');
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-line space-y-3">
              <p className="text-sm text-ink font-medium flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5 text-faint" /> Realtors
              </p>

              {realtorsLoading ? (
                <p className="text-sm text-muted">Loading.</p>
              ) : realtors.length === 0 ? (
                <p className="text-sm text-faint">No realtor linked to this person.</p>
              ) : (
                <div className="space-y-1.5">
                  {realtors.map(r => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 border border-line rounded-lg">
                      <div>
                        <p className="text-sm text-ink">{r.name}</p>
                        <p className="text-xs text-muted">Access ends {formatDate(r.accessEndsOn)}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveRealtor(r.realtorUserId)}
                        disabled={removingRealtorId === r.realtorUserId}
                        className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors disabled:opacity-50"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {availableRealtors.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-line rounded-lg bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                    value={selectedRealtorId}
                    onChange={(e) => setSelectedRealtorId(e.target.value)}
                  >
                    <option value="">Choose a realtor...</option>
                    {availableRealtors.map(u => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedRealtorId || linking}
                    onClick={handleLinkRealtor}
                  >
                    {linking ? 'Linking...' : 'Link'}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conversation history with this tenant, from the portal messaging. */}
      {id && <MessagesCard tenantId={id} canReply={canManagePortal} />}

      {/* Payment history */}
      <Card>
        <CardContent className="p-0">
          <div className="p-5 pb-0">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-faint" /> Payment History
            </h3>
          </div>
          <div className="overflow-x-auto mt-3">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Month</th>
                  <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Amount</th>
                  <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Method</th>
                  <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Date</th>
                  <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const receiptId = p.receiptDocumentId ?? receiptIds[p.id];
                  return (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-3 px-5 text-sm text-ink">{formatMonthYear(p.month, p.year)}</td>
                    <td className="py-3 px-5 text-sm text-ink text-right tnum">{formatCurrency(p.amount)}</td>
                    <td className="py-3 px-5 text-sm text-muted">{formatMethod(p.paymentMethod)}</td>
                    <td className="py-3 px-5 text-sm text-muted">
                      {p.paidDate ? formatDate(p.paidDate) : p.dueDate ? formatDate(p.dueDate) : '—'}
                    </td>
                    <td className="py-3 px-5 text-sm">
                      {receiptId ? (
                        <a
                          href={`/api/documents/${receiptId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-primary hover:text-primary-hover"
                        >
                          Download
                        </a>
                      ) : p.status === 'paid' && hasPermission('rents_record') ? (
                        <button
                          type="button"
                          onClick={() => handleGenerateReceipt(p.id)}
                          disabled={generatingReceipt === p.id}
                          className="font-medium text-muted hover:text-ink disabled:opacity-50"
                        >
                          {generatingReceipt === p.id ? 'Generating...' : 'Generate'}
                        </button>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {payments.length === 0 && (
            <div className="text-center py-12">
              <DollarSign className="h-8 w-8 mx-auto text-faint mb-2" />
              <p className="text-sm text-muted">No payments recorded for this person yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit modal */}
      <Modal isOpen={tenancyOpen} onClose={() => (savingTenancy ? undefined : setTenancyOpen(false))} title="Edit tenancy" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Monthly Rent *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full pl-7 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={tenancyForm.monthlyRent}
                onChange={(e) => setTenancyForm({ ...tenancyForm, monthlyRent: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <p className="text-xs text-muted mt-1">Saving this also sets the unit's current rent to match.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Start Date</label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={tenancyForm.startDate}
                onChange={(e) => setTenancyForm({ ...tenancyForm, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">End Date</label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={tenancyForm.endDate}
                onChange={(e) => setTenancyForm({ ...tenancyForm, endDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Move-In Fee</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full pl-7 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={tenancyForm.moveInFee}
                onChange={(e) => setTenancyForm({ ...tenancyForm, moveInFee: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line-strong"
                checked={tenancyForm.moveInFeePaid}
                onChange={(e) => setTenancyForm({ ...tenancyForm, moveInFeePaid: e.target.checked })}
              />
              Move-in fee already paid
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setTenancyOpen(false)} disabled={savingTenancy}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={handleSaveTenancy} disabled={savingTenancy}>
              {savingTenancy ? 'Saving…' : 'Save tenancy'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={approveOpen} onClose={() => (approving ? undefined : setApproveOpen(false))} title="Approve tenancy" size="md">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Confirm the rent and dates for this placement. Approving makes it a live tenancy: it starts billing rent and
            the status becomes Active. The unit is already marked occupied.
          </p>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Monthly Rent *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full pl-7 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={approveForm.monthlyRent}
                onChange={(e) => setApproveForm({ ...approveForm, monthlyRent: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Start Date *</label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={approveForm.startDate}
                onChange={(e) => setApproveForm({ ...approveForm, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">End Date</label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={approveForm.endDate}
                onChange={(e) => setApproveForm({ ...approveForm, endDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Move-In Fee</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full pl-7 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={approveForm.moveInFee}
                onChange={(e) => setApproveForm({ ...approveForm, moveInFee: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line-strong"
                checked={approveForm.moveInFeePaid}
                onChange={(e) => setApproveForm({ ...approveForm, moveInFeePaid: e.target.checked })}
              />
              Move-in fee already paid
            </label>
            {!approveForm.moveInFeePaid && approveForm.moveInFee && (
              <p className="text-xs text-muted mt-1">Will show as owed on their record until you mark it paid.</p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setApproveOpen(false)} disabled={approving}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={handleApprove} disabled={approving}>
              <Check className="h-4 w-4 mr-2" />
              {approving ? 'Approving…' : 'Approve tenancy'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Tenant" size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">First Name *</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Last Name *</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Email</label>
              <input
                type="email"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
              <input
                type="tel"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
            <textarea
              rows={3}
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Private notes, for example who pays the rent, their phone number, or any payment arrangement."
            />
            <p className="text-xs text-muted mt-1">
              Private to the office, never shown to the tenant. Searchable from the Tenants page.
            </p>
          </div>

          <hr className="border-line" />

          <h3 className="font-semibold text-ink flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-faint" /> Emergency Contact
          </h3>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Name</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              value={form.emergencyName}
              onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
              <input
                type="tel"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={form.emergencyPhone}
                onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Relationship</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                placeholder="e.g. Parent, Sibling"
                value={form.emergencyRelationship}
                onChange={(e) => setForm({ ...form, emergencyRelationship: e.target.value })}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={tenantToDelete}
        onClose={() => setTenantToDelete(false)}
        onConfirm={handleDeleteTenant}
        title="Delete tenant"
        message={
          user?.roleId === 'super_admin'
            ? 'This permanently deletes this tenant, frees up their unit, and removes their lease and all their rent records (paid and unpaid). Their Google Drive folder is left as is. This cannot be undone.'
            : 'This removes this tenant. Their lease payment records are kept. This cannot be undone.'
        }
        confirmText="Delete"
      />

      {/* Terminate tenancy: capture the move-out date and reason. */}
      <Modal isOpen={terminateOpen} onClose={() => setTerminateOpen(false)} title="Terminate tenancy" size="md">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This ends the tenancy and frees up the unit. Rent stops from the month after the move-out date. The lease and payment history are kept.
          </p>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Move-out date *</label>
            <input
              type="date"
              value={termForm.date}
              onChange={(e) => setTermForm({ ...termForm, date: e.target.value })}
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Reason for leaving</label>
            <textarea
              rows={3}
              value={termForm.reason}
              onChange={(e) => setTermForm({ ...termForm, reason: e.target.value })}
              placeholder="e.g. Lease ended, moving out of state, non-renewal, eviction."
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setTerminateOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleTerminate} disabled={terminating}>
              {terminating ? 'Terminating...' : 'Terminate tenancy'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** A real instant (unix seconds), so toLocaleString is correct here. */
function messageWhen(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// The office's conversation history with this tenant, folded into the profile so
// past messages are trackable in one place. Reading it marks the tenant's
// messages read (same as opening the inbox thread); the office can reply inline.
function MessagesCard({ tenantId, canReply }: { tenantId: string; canReply: boolean }) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const pollRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (pollRef.current) return;
    pollRef.current = true;
    try {
      const res = await messagesApi.thread(tenantId);
      setMessages((prev) => {
        const next = res.messages;
        const same = next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id;
        return same ? prev : next;
      });
    } catch {
      // Ignore; the card keeps showing what it already has.
    } finally {
      pollRef.current = false;
    }
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    messagesApi.thread(tenantId)
      .then((res) => { if (!cancelled) setMessages(res.messages); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const iv = window.setInterval(tick, 8000);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.clearInterval(iv); window.removeEventListener('focus', refresh); };
  }, [tenantId, refresh]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await messagesApi.reply(tenantId, body);
      setMessages((prev) => [...prev, sent]);
      setDraft('');
    } catch (err) {
      showToast((err as Error).message || 'Could not send your reply.', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold text-ink flex items-center gap-2 mb-4">
          <MessageSquare className="h-4 w-4 text-faint" /> Messages
        </h3>
        {loading ? (
          <p className="text-sm text-muted">Loading conversation.</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted">No messages with this tenant yet.</p>
        ) : (
          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {messages.map((m) => {
              const office = m.senderRole === 'office';
              return (
                <div key={m.id} className={office ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[80%] ${office ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${office ? 'bg-primary text-white rounded-br-sm' : 'bg-canvas border border-line text-ink rounded-bl-sm'}`}>
                      {m.body}
                    </div>
                    <span className="text-[11px] text-faint mt-1 px-1">{office ? 'You' : 'Tenant'} · {messageWhen(m.createdAt)}</span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {canReply && (
          <form onSubmit={send} className="mt-4 flex items-end gap-2 border-t border-line pt-4">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
              rows={2}
              maxLength={4000}
              placeholder="Reply to this tenant..."
              className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button type="submit" disabled={sending || !draft.trim()}>
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Sending...' : 'Send'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
