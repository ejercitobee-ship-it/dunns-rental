import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, User, Mail, Phone, ShieldAlert, FileText, Upload, MapPin, Pencil, X, Check, Users, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { EmailInput } from '../../components/ui/EmailInput';
import { portalApi, type AppDocument, type PortalPerson, type HouseholdMember, type HouseholdInput } from '../../lib/api';
import { formatPhone, isValidEmail } from '../../lib/utils';
import { useToast } from '../../context/ToastContext';

export function RealtorTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [tenant, setTenant] = useState<PortalPerson | null>(null);
  const [docs, setDocs] = useState<AppDocument[]>([]);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Contact edit state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    emergencyName: '', emergencyPhone: '', emergencyRelationship: '',
  });

  // Household add/edit state
  const [addingMember, setAddingMember] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState<HouseholdInput>({ name: '', phone: '', relationship: '' });
  const [memberSaving, setMemberSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      portalApi.realtorTenant(id),
      portalApi.documents(id),
      portalApi.realtorHousehold.list(id),
    ])
      .then(([t, docList, hh]) => {
        if (cancelled) return;
        setTenant(t);
        setDocs(docList);
        setHousehold(hh);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load this tenant.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const startEdit = () => {
    if (!tenant) return;
    setForm({
      firstName: tenant.firstName || '',
      lastName: tenant.lastName || '',
      email: tenant.email || '',
      phone: tenant.phone || '',
      emergencyName: tenant.emergencyContact?.name || '',
      emergencyPhone: tenant.emergencyContact?.phone || '',
      emergencyRelationship: tenant.emergencyContact?.relationship || '',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveContact = async () => {
    if (!id || saving) return;
    if (!form.firstName.trim() || !form.lastName.trim()) {
      showToast('First and last name are required.', 'error');
      return;
    }
    if (!form.email.trim() || !isValidEmail(form.email)) {
      showToast('A valid email is required.', 'error');
      return;
    }
    if (!form.phone.replace(/\D/g, '')) {
      showToast('Phone is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await portalApi.updateRealtorTenant(id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.replace(/\D/g, ''),
        emergencyName: form.emergencyName.trim() || undefined,
        emergencyPhone: form.emergencyPhone.replace(/\D/g, '') || undefined,
        emergencyRelationship: form.emergencyRelationship.trim() || undefined,
      });
      setTenant(prev => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
      showToast('Contact info updated.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save changes.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await portalApi.uploadDocument(file, id);
      setDocs(await portalApi.documents(id));
      showToast('Document uploaded.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Upload failed.', 'error');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startAddMember = () => {
    setMemberForm({ name: '', phone: '', relationship: '' });
    setEditingMemberId(null);
    setAddingMember(true);
  };

  const startEditMember = (m: HouseholdMember) => {
    setMemberForm({ name: m.name, phone: m.phone || '', relationship: m.relationship || '' });
    setEditingMemberId(m.id);
    setAddingMember(false);
  };

  const cancelMemberForm = () => {
    setAddingMember(false);
    setEditingMemberId(null);
  };

  const saveMember = async () => {
    if (!id || memberSaving) return;
    if (!memberForm.name.trim()) {
      showToast('Name is required.', 'error');
      return;
    }
    setMemberSaving(true);
    try {
      const payload: HouseholdInput = {
        name: memberForm.name.trim(),
        phone: (memberForm.phone || '').replace(/\D/g, '') || undefined,
        relationship: memberForm.relationship?.trim() || undefined,
      };
      if (editingMemberId) {
        const updated = await portalApi.realtorHousehold.update(editingMemberId, payload);
        setHousehold(prev => prev.map(m => m.id === editingMemberId ? updated : m));
        showToast('Household member updated.', 'success');
      } else {
        const added = await portalApi.realtorHousehold.add(id, payload);
        setHousehold(prev => [...prev, added]);
        showToast('Household member added.', 'success');
      }
      cancelMemberForm();
    } catch (err) {
      showToast((err as Error).message || 'Could not save household member.', 'error');
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!confirm('Remove this household member?')) return;
    try {
      await portalApi.realtorHousehold.remove(memberId);
      setHousehold(prev => prev.filter(m => m.id !== memberId));
      if (editingMemberId === memberId) cancelMemberForm();
      showToast('Household member removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in fade-in duration-200">
        <User className="h-8 w-8 text-faint animate-pulse" />
        <p className="text-sm text-muted">Loading tenant details</p>
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="space-y-6">
        <Link
          to="/portal/tenants"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
        >
          <ArrowLeft className="h-4 w-4" /> Back to my tenants
        </Link>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-danger">{error || 'Tenant not found.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const inputCls = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/10';

  return (
    <div className="space-y-6">
      <Link
        to="/portal/tenants"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my tenants
      </Link>

      <div className="flex items-center gap-4">
        <Avatar
          photoUrl={tenant.photoUrl}
          initials={`${tenant.firstName?.[0] ?? ''}${tenant.lastName?.[0] ?? ''}`}
          className="w-14 h-14 flex-shrink-0"
          initialsClassName="text-lg"
        />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-[26px] sm:text-[30px] font-medium text-ink leading-tight">
              {tenant.firstName} {tenant.lastName}
            </h1>
            {tenant.approval === 'under_review' && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-soft text-warning">
                Under review
              </span>
            )}
            {tenant.approval === 'approved' && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary-soft text-primary">
                Approved
              </span>
            )}
          </div>
          {tenant.approval === 'under_review' && (
            <p className="text-sm text-muted mt-0.5">
              This placement is with the office for approval. You will see it change to Approved once confirmed.
            </p>
          )}
        </div>
      </div>

      {/* Contact info card */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <User className="h-4 w-4 text-faint" /> Contact
            </h3>
            {!editing && (
              <Button type="button" variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">First name</label>
                  <input className={inputCls} value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Last name</label>
                  <input className={inputCls} value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Email</label>
                  <EmailInput className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Phone</label>
                  <input className={inputCls} value={formatPhone(form.phone)} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                </div>
              </div>

              <div className="pt-2 border-t border-line">
                <p className="eyebrow mb-2 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" /> Emergency contact
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Name</label>
                    <input className={inputCls} value={form.emergencyName} onChange={e => setForm(f => ({ ...f, emergencyName: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Phone</label>
                    <input className={inputCls} value={formatPhone(form.emergencyPhone)} onChange={e => setForm(f => ({ ...f, emergencyPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Relationship</label>
                    <input className={inputCls} value={form.emergencyRelationship} onChange={e => setForm(f => ({ ...f, emergencyRelationship: e.target.value }))} placeholder="e.g. Spouse" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button type="button" size="sm" onClick={saveContact} disabled={saving}>
                  <Check className="h-3.5 w-3.5 mr-1.5" /> {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted">
                  <Mail className="h-3.5 w-3.5 text-faint" />
                  <span className="truncate">{tenant.email || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Phone className="h-3.5 w-3.5 text-faint" />
                  <span>{tenant.phone ? formatPhone(tenant.phone) : '—'}</span>
                </div>
              </div>

              {tenant.emergencyContact && (
                <div className="pt-2 border-t border-line">
                  <p className="eyebrow mb-2 flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5" /> Emergency contact
                  </p>
                  <div className="text-sm space-y-1">
                    <p className="text-ink font-medium">{tenant.emergencyContact.name}</p>
                    <p className="text-muted">{tenant.emergencyContact.phone ? formatPhone(tenant.emergencyContact.phone) : ''}</p>
                    <p className="text-muted capitalize">{tenant.emergencyContact.relationship}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Address card */}
      {tenant.unit && (tenant.unit.address || tenant.unit.unitNumber) && (
        <Card>
          <CardContent className="p-5 space-y-2">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <MapPin className="h-4 w-4 text-faint" /> Address
            </h3>
            <div className="text-sm space-y-0.5">
              {tenant.unit.address && <p className="text-ink">{tenant.unit.address}</p>}
              {(tenant.unit.city || tenant.unit.state || tenant.unit.zipCode) && (
                <p className="text-muted">
                  {[tenant.unit.city, [tenant.unit.state, tenant.unit.zipCode].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              {tenant.unit.unitNumber && <p className="text-muted">Unit {tenant.unit.unitNumber}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Household members card */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <Users className="h-4 w-4 text-faint" /> Household Members
            </h3>
            {!addingMember && !editingMemberId && (
              <Button type="button" variant="outline" size="sm" onClick={startAddMember}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add
              </Button>
            )}
          </div>

          {/* Add / edit form */}
          {(addingMember || editingMemberId) && (
            <div className="rounded-lg border border-line bg-canvas p-4 space-y-3">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                {editingMemberId ? 'Edit member' : 'New member'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Name *</label>
                  <input className={inputCls} value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Phone</label>
                  <input className={inputCls} value={formatPhone(memberForm.phone || '')} onChange={e => setMemberForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Relationship</label>
                  <input className={inputCls} value={memberForm.relationship || ''} onChange={e => setMemberForm(f => ({ ...f, relationship: e.target.value }))} placeholder="e.g. Spouse" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={saveMember} disabled={memberSaving}>
                  <Check className="h-3.5 w-3.5 mr-1.5" /> {memberSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={cancelMemberForm} disabled={memberSaving}>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Cancel
                </Button>
              </div>
            </div>
          )}

          {household.length === 0 && !addingMember ? (
            <p className="text-sm text-muted">No household members listed yet.</p>
          ) : (
            <div className="space-y-1.5">
              {household.map(m => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-line"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{m.name}</p>
                    <p className="text-xs text-muted">
                      {[m.relationship, m.phone ? formatPhone(m.phone) : null].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors"
                      onClick={() => startEditMember(m)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      onClick={() => removeMember(m.id)}
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documents card */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <FileText className="h-4 w-4 text-faint" /> Documents
            </h3>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-muted">No documents yet.</p>
          ) : (
            <div className="space-y-1.5">
              {docs.map((doc) => (
                <a
                  key={doc.id}
                  href={portalApi.downloadUrl(doc.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 border border-line rounded-lg hover:border-primary/30 hover:bg-primary-soft/30 transition-colors min-w-0"
                >
                  <FileText className="h-4 w-4 text-faint flex-shrink-0" />
                  <span className="text-sm text-ink truncate">{doc.name}</span>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
