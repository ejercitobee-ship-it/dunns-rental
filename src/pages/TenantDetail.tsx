import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, User, Edit2, Home, DoorOpen, Calendar, DollarSign,
  FileText, Upload, Download, Trash2, Users, ShieldAlert, KeyRound, Briefcase,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate, formatMonthYear } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  documentsApi, tenantsApi, householdApi, photoApi, paymentsApi,
  type AppDocument, type TenantRealtorLink, type RealtorUserOption, type HouseholdMember,
} from '../lib/api';
import { resizeImage } from '../lib/image';
import { leasesOwingMonth, settleMonth } from '../lib/rent';
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
    updateTenant, deleteTenant, getLeaseTenants, getTenantLeases,
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

  const housemates = useMemo(() => {
    if (!lease || !id) return [];
    return getLeaseTenants(lease.id).filter(h => h.id !== id);
  }, [lease, id, getLeaseTenants]);

  const property = lease?.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
  const unit = lease?.unitId ? units.find(u => u.id === lease.unitId) : undefined;

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
            {lease ? (
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant={leaseStatusBadge[lease.status]}>{leaseStatusLabel[lease.status]}</Badge>
                {lease.needsReview && <Badge variant="warning">Needs review</Badge>}
              </div>
            ) : (
              <Badge variant="outline" className="mt-1">No tenancy</Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button onClick={openEdit} className="flex-1 sm:flex-none">
            <Edit2 className="h-4 w-4 mr-2" />
            Edit Person
          </Button>
          {hasPermission('tenants_delete') && (
            <Button
              variant="destructive"
              className="flex-1 sm:flex-none"
              onClick={() => setTenantToDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete tenant
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
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <Home className="h-4 w-4 text-faint" /> Tenancy
            </h3>
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
                {thisMonth && (
                  <div className="pt-2 border-t border-line flex items-center justify-between">
                    <span className="eyebrow">This Month</span>
                    <Badge variant={settlementBadge[thisMonth.status]} className="capitalize">{thisMonth.status}</Badge>
                  </div>
                )}
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
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Person" size="lg">
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
              rows={2}
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any additional notes..."
            />
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
    </div>
  );
}
