import { useCallback, useEffect, useState } from 'react';
import {
  FileWarning, Plus, ChevronDown, ChevronUp, Pencil, Trash2,
  Eye, Send, Mail,
} from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { formatDate, formatCurrency, todayLocalDate } from '../lib/utils';
import { noticesApi, settingsApi, type AppSettings } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Notice, NoticeType, NoticeStatus, DeliveryMethod } from '../types';

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------
interface TemplateContext {
  tenantName: string;
  propertyAddress: string;
  unitNumber: string;
  monthlyRent: string;
  leaseEndDate: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  today: string;
  lateFeeAmount: string;
  gracePeriod: string;
}

const NOTICE_TEMPLATES: Record<Exclude<NoticeType, 'custom'>, { title: string; body: (ctx: TemplateContext) => string }> = {
  late_rent: {
    title: 'Late Rent Notice',
    body: (ctx) =>
`Date: ${ctx.today}

To: ${ctx.tenantName}
Property: ${ctx.propertyAddress}${ctx.unitNumber ? `, Unit ${ctx.unitNumber}` : ''}

RE: Late Rent Payment

Dear ${ctx.tenantName},

This letter is to notify you that your rent payment of ${ctx.monthlyRent} is past due. Per your lease agreement, rent is due on the first of each month. A grace period of ${ctx.gracePeriod} days is allowed before a late fee of ${ctx.lateFeeAmount} is assessed.

Please remit full payment immediately to avoid further action. If you have already submitted your payment, please disregard this notice.

If you are experiencing financial difficulties, please contact our office to discuss payment arrangements.

Sincerely,

${ctx.companyName}
${ctx.companyAddress}
${ctx.companyPhone}`,
  },

  violation: {
    title: 'Lease Violation Notice',
    body: (ctx) =>
`Date: ${ctx.today}

To: ${ctx.tenantName}
Property: ${ctx.propertyAddress}${ctx.unitNumber ? `, Unit ${ctx.unitNumber}` : ''}

RE: Lease Violation

Dear ${ctx.tenantName},

This letter is to inform you that a violation of your lease agreement has been observed at the above property.

Description of violation:
[DESCRIBE THE VIOLATION HERE]

You are required to correct this violation within 10 days of receiving this notice. Failure to comply may result in further action, up to and including lease termination, as permitted under Illinois law.

If you have questions about this notice, please contact our office.

Sincerely,

${ctx.companyName}
${ctx.companyAddress}
${ctx.companyPhone}`,
  },

  non_renewal: {
    title: 'Notice of Non-Renewal',
    body: (ctx) =>
`Date: ${ctx.today}

To: ${ctx.tenantName}
Property: ${ctx.propertyAddress}${ctx.unitNumber ? `, Unit ${ctx.unitNumber}` : ''}

RE: Non-Renewal of Lease

Dear ${ctx.tenantName},

This letter serves as formal notice that your lease agreement for the above property will not be renewed upon its expiration on ${ctx.leaseEndDate}.

Please make arrangements to vacate the premises by the end of your current lease term. The unit should be left in clean condition, and all keys must be returned to our office.

Your security deposit will be handled in accordance with Illinois law. Please provide a forwarding address for the return of your deposit.

If you have any questions, please do not hesitate to contact us.

Sincerely,

${ctx.companyName}
${ctx.companyAddress}
${ctx.companyPhone}`,
  },

  rent_increase: {
    title: 'Rent Increase Notice',
    body: (ctx) =>
`Date: ${ctx.today}

To: ${ctx.tenantName}
Property: ${ctx.propertyAddress}${ctx.unitNumber ? `, Unit ${ctx.unitNumber}` : ''}

RE: Rent Increase

Dear ${ctx.tenantName},

This letter is to inform you that the monthly rent for your unit will be adjusted effective [EFFECTIVE DATE].

Current monthly rent: ${ctx.monthlyRent}
New monthly rent: [NEW AMOUNT]

This adjustment reflects [REASON: e.g., increased property taxes, maintenance costs, market conditions].

This notice is provided in accordance with the terms of your lease agreement and applicable Illinois law.

If you have any questions or concerns, please contact our office.

Sincerely,

${ctx.companyName}
${ctx.companyAddress}
${ctx.companyPhone}`,
  },
};

const TYPE_LABEL: Record<NoticeType, string> = {
  late_rent: 'Late Rent',
  violation: 'Lease Violation',
  non_renewal: 'Non-Renewal',
  rent_increase: 'Rent Increase',
  custom: 'Custom',
};

const STATUS_BADGE: Record<NoticeStatus, 'warning' | 'secondary' | 'success'> = {
  draft: 'warning',
  sent: 'secondary',
  acknowledged: 'success',
};

const STATUS_LABEL: Record<NoticeStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
};

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  hand_delivered: 'Hand Delivered',
  posted: 'Posted',
  email: 'Email',
  certified_mail: 'Certified Mail',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  tenantId: string;
  tenantName: string;
  leaseId: string;
  propertyId?: string;
  unitId?: string;
  propertyAddress?: string;
  unitNumber?: string;
  monthlyRent?: number;
  leaseEndDate?: string;
}

export function NoticeSection({
  tenantId, tenantName, leaseId, propertyId, unitId,
  propertyAddress, unitNumber, monthlyRent, leaseEndDate,
}: Props) {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const canEdit = hasPermission('tenants_edit');

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formType, setFormType] = useState<NoticeType>('late_rent');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formDate, setFormDate] = useState(todayLocalDate());
  const [formDelivery, setFormDelivery] = useState<DeliveryMethod | ''>('');
  const [formStatus, setFormStatus] = useState<NoticeStatus>('draft');
  const [saving, setSaving] = useState(false);

  // View modal
  const [viewNotice, setViewNotice] = useState<Notice | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await noticesApi.getAll({ tenantId });
      setNotices(data);
    } catch {
      // table might not exist yet
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Load settings for template auto-fill
  useEffect(() => {
    settingsApi.get().then(setSettings).catch(() => {});
  }, []);

  const buildContext = useCallback((): TemplateContext => ({
    tenantName: tenantName || 'Tenant',
    propertyAddress: propertyAddress || '[Property Address]',
    unitNumber: unitNumber || '',
    monthlyRent: monthlyRent ? formatCurrency(monthlyRent) : '[Rent Amount]',
    leaseEndDate: leaseEndDate ? formatDate(leaseEndDate) : '[Lease End Date]',
    companyName: settings?.company?.companyName || 'MH Dunn Property',
    companyAddress: settings?.company ? `${settings.company.address}, ${settings.company.city}, ${settings.company.state} ${settings.company.zipCode}` : '[Company Address]',
    companyPhone: settings?.company?.phone || '[Phone]',
    today: formatDate(todayLocalDate()),
    lateFeeAmount: settings?.rent?.lateFeeAmount ? formatCurrency(settings.rent.lateFeeAmount) : '[Late Fee]',
    gracePeriod: settings?.rent?.gracePeriod?.toString() || '5',
  }), [tenantName, propertyAddress, unitNumber, monthlyRent, leaseEndDate, settings]);

  const openCreate = useCallback((type: NoticeType) => {
    setEditingId(null);
    setFormType(type);
    setFormDate(todayLocalDate());
    setFormDelivery('');
    setFormStatus('draft');

    if (type !== 'custom' && NOTICE_TEMPLATES[type]) {
      const tmpl = NOTICE_TEMPLATES[type];
      setFormTitle(tmpl.title);
      setFormBody(tmpl.body(buildContext()));
    } else {
      setFormTitle('');
      setFormBody('');
    }
    setIsFormOpen(true);
  }, [buildContext]);

  const openEdit = useCallback((notice: Notice) => {
    setEditingId(notice.id);
    setFormType(notice.type);
    setFormTitle(notice.title);
    setFormBody(notice.body);
    setFormDate(notice.noticeDate);
    setFormDelivery(notice.deliveryMethod || '');
    setFormStatus(notice.status);
    setIsFormOpen(true);
  }, []);

  const handleTemplateChange = useCallback((type: NoticeType) => {
    setFormType(type);
    if (type !== 'custom' && NOTICE_TEMPLATES[type] && !editingId) {
      const tmpl = NOTICE_TEMPLATES[type];
      setFormTitle(tmpl.title);
      setFormBody(tmpl.body(buildContext()));
    }
  }, [buildContext, editingId]);

  const handleSave = useCallback(async () => {
    if (!formTitle.trim() || !formBody.trim()) {
      showToast('Title and body are required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await noticesApi.update(editingId, {
          type: formType,
          title: formTitle,
          body: formBody,
          noticeDate: formDate,
          deliveryMethod: formDelivery || undefined,
          status: formStatus,
        });
        showToast('Notice updated', 'success');
      } else {
        await noticesApi.create({
          propertyId,
          unitId,
          leaseId,
          tenantId,
          type: formType,
          title: formTitle,
          body: formBody,
          noticeDate: formDate,
          deliveryMethod: formDelivery || undefined,
          status: formStatus,
        });
        showToast('Notice created', 'success');
      }
      setIsFormOpen(false);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }, [editingId, formType, formTitle, formBody, formDate, formDelivery, formStatus, propertyId, unitId, leaseId, tenantId, showToast, load]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await noticesApi.delete(deleteTarget);
      showToast('Notice deleted', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }, [deleteTarget, showToast, load]);

  const markSent = useCallback(async (notice: Notice) => {
    try {
      await noticesApi.update(notice.id, { status: 'sent', deliveredAt: todayLocalDate() });
      showToast('Notice marked as sent', 'success');
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }, [showToast, load]);

  if (loading) return null;

  return (
    <>
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-faint" />
              Notices & Letters
            </h3>
            {canEdit && (
              <div className="flex gap-1 flex-wrap">
                <Button size="sm" onClick={() => openCreate('late_rent')}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Late Rent
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCreate('violation')}>
                  Violation
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCreate('non_renewal')}>
                  Non-Renewal
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCreate('rent_increase')}>
                  Rent Increase
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCreate('custom')}>
                  Custom
                </Button>
              </div>
            )}
          </div>

          {notices.length === 0 ? (
            <p className="text-sm text-muted">
              No notices have been sent to this tenant.
            </p>
          ) : (
            <div className="space-y-2">
              {notices.map(notice => {
                const isExpanded = expanded === notice.id;
                return (
                  <div key={notice.id} className="border border-line rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-canvas/60 transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : notice.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={STATUS_BADGE[notice.status]}>
                          {STATUS_LABEL[notice.status]}
                        </Badge>
                        <span className="text-sm text-ink font-medium truncate">
                          {notice.title}
                        </span>
                        <span className="text-xs text-muted shrink-0">{formatDate(notice.noticeDate)}</span>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-line p-4 space-y-3 bg-canvas/30">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          <div>
                            <p className="eyebrow">Type</p>
                            <p className="text-ink">{TYPE_LABEL[notice.type]}</p>
                          </div>
                          <div>
                            <p className="eyebrow">Date</p>
                            <p className="text-ink">{formatDate(notice.noticeDate)}</p>
                          </div>
                          {notice.deliveryMethod && (
                            <div>
                              <p className="eyebrow">Delivery</p>
                              <p className="text-ink">{DELIVERY_LABEL[notice.deliveryMethod]}</p>
                            </div>
                          )}
                          {notice.deliveredAt && (
                            <div>
                              <p className="eyebrow">Delivered</p>
                              <p className="text-ink">{formatDate(notice.deliveredAt)}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 pt-2 border-t border-line flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => setViewNotice(notice)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> View
                          </Button>
                          {canEdit && notice.status === 'draft' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openEdit(notice)}>
                                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => markSent(notice)}>
                                <Send className="h-3.5 w-3.5 mr-1" /> Mark Sent
                              </Button>
                            </>
                          )}
                          {canEdit && (
                            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(notice.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit notice modal */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => !saving && setIsFormOpen(false)}
        title={editingId ? 'Edit Notice' : 'Create Notice'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Template</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formType}
                onChange={e => handleTemplateChange(e.target.value as NoticeType)}
              >
                <option value="late_rent">Late Rent</option>
                <option value="violation">Lease Violation</option>
                <option value="non_renewal">Non-Renewal</option>
                <option value="rent_increase">Rent Increase</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Notice Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Title</label>
            <input
              type="text"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Notice title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Body</label>
            <textarea
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink font-mono min-h-[300px]"
              value={formBody}
              onChange={e => setFormBody(e.target.value)}
              placeholder="Notice content..."
            />
            <p className="text-xs text-muted mt-1">
              Edit the text above as needed. Bracketed items like [DESCRIBE THE VIOLATION HERE] should be replaced with actual details.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Delivery Method</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formDelivery}
                onChange={e => setFormDelivery(e.target.value as DeliveryMethod | '')}
              >
                <option value="">Select method</option>
                <option value="hand_delivered">Hand Delivered</option>
                <option value="posted">Posted (Mail)</option>
                <option value="email">Email</option>
                <option value="certified_mail">Certified Mail</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Status</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formStatus}
                onChange={e => setFormStatus(e.target.value as NoticeStatus)}
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="acknowledged">Acknowledged</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formTitle.trim() || !formBody.trim()}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Notice'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* View notice modal (read-only, printable) */}
      <Modal
        isOpen={!!viewNotice}
        onClose={() => setViewNotice(null)}
        title={viewNotice?.title || ''}
        size="lg"
      >
        {viewNotice && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <Badge variant={STATUS_BADGE[viewNotice.status]}>{STATUS_LABEL[viewNotice.status]}</Badge>
              <span className="text-muted">{TYPE_LABEL[viewNotice.type]}</span>
              <span className="text-muted">{formatDate(viewNotice.noticeDate)}</span>
              {viewNotice.deliveryMethod && (
                <span className="flex items-center gap-1 text-muted">
                  <Mail className="h-3 w-3" /> {DELIVERY_LABEL[viewNotice.deliveryMethod]}
                </span>
              )}
            </div>
            <div className="border border-line rounded-lg p-6 bg-white text-ink font-mono text-sm whitespace-pre-wrap leading-relaxed print:border-0 print:p-0">
              {viewNotice.body}
            </div>
            <div className="flex justify-end gap-2 no-print">
              <Button variant="outline" onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="outline" onClick={() => setViewNotice(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Notice"
        message="This will permanently delete this notice. This cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
