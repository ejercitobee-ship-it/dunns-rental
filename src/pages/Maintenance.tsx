import { useState, useMemo } from 'react';
import { Plus, Wrench, Search, Edit2, Trash2, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, todayLocalDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type { MaintenanceRequest, MaintenancePriority, MaintenanceStatus } from '../types';

const CATEGORIES = ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'general', 'other'];

const priorityBadge: Record<MaintenancePriority, 'secondary' | 'warning' | 'destructive'> = {
  low: 'secondary',
  medium: 'secondary',
  high: 'warning',
  urgent: 'destructive',
};

const statusBadge: Record<MaintenanceStatus, 'warning' | 'default' | 'success' | 'secondary'> = {
  open: 'warning',
  in_progress: 'default',
  resolved: 'success',
  cancelled: 'secondary',
};

const statusLabel: Record<MaintenanceStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

const emptyForm = {
  title: '',
  description: '',
  propertyId: '',
  unitId: '',
  tenantId: '',
  category: 'general',
  priority: 'medium' as MaintenancePriority,
  status: 'open' as MaintenanceStatus,
  cost: 0,
  vendor: '',
  reportedDate: todayLocalDate(),
  notes: '',
};

export function Maintenance() {
  const { maintenance, properties, units, addMaintenance, updateMaintenance, deleteMaintenance } = useApp();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | 'all'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const propertyName = (id?: string) => properties.find(p => p.id === id)?.name || '—';
  const unitNumber = (id?: string) => units.find(u => u.id === id)?.unitNumber;

  const stats = useMemo(() => {
    const open = maintenance.filter(m => m.status === 'open').length;
    const inProgress = maintenance.filter(m => m.status === 'in_progress').length;
    const urgent = maintenance.filter(m => m.priority === 'urgent' && m.status !== 'resolved' && m.status !== 'cancelled').length;
    const spend = maintenance.filter(m => m.status === 'resolved').reduce((s, m) => s + (m.cost || 0), 0);
    return { open, inProgress, urgent, spend };
  }, [maintenance]);

  const filtered = useMemo(() => {
    return maintenance.filter(m => {
      const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        m.title.toLowerCase().includes(q) ||
        propertyName(m.propertyId).toLowerCase().includes(q) ||
        (m.vendor || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenance, statusFilter, search, properties]);

  const availableUnits = units.filter(u => !form.propertyId || u.propertyId === form.propertyId);

  const openNew = () => {
    setForm(emptyForm);
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEdit = (m: MaintenanceRequest) => {
    setForm({
      title: m.title,
      description: m.description || '',
      propertyId: m.propertyId || '',
      unitId: m.unitId || '',
      tenantId: m.tenantId || '',
      category: m.category || 'general',
      priority: m.priority,
      status: m.status,
      cost: m.cost || 0,
      vendor: m.vendor || '',
      reportedDate: m.reportedDate || todayLocalDate(),
      notes: m.notes || '',
    });
    setEditingId(m.id);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      const payload = {
        ...form,
        cost: Number(form.cost) || 0,
        propertyId: form.propertyId || undefined,
        unitId: form.unitId || undefined,
        tenantId: form.tenantId || undefined,
      };
      if (editingId) {
        await updateMaintenance({ id: editingId, ...payload });
        showToast('Request updated', 'success');
      } else {
        await addMaintenance(payload);
        showToast('Request created', 'success');
      }
      setIsModalOpen(false);
    } catch (err) {
      showToast((err as Error).message || 'Could not save the request', 'error');
    }
  };

  const quickStatus = async (m: MaintenanceRequest, status: MaintenanceStatus) => {
    try {
      await updateMaintenance({ ...m, status });
      showToast(`Marked ${statusLabel[status].toLowerCase()}`, 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update', 'error');
    }
  };

  const handleDelete = async (m: MaintenanceRequest) => {
    if (!confirm('Delete this maintenance request?')) return;
    try {
      await deleteMaintenance(m.id);
      showToast('Request deleted', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete', 'error');
    }
  };

  const statCards = [
    { label: 'Open', value: stats.open, icon: <Clock /> },
    { label: 'In Progress', value: stats.inProgress, icon: <Wrench /> },
    { label: 'Urgent', value: stats.urgent, icon: <AlertTriangle /> },
    { label: 'Resolved Spend', value: formatCurrency(stats.spend), icon: <CheckCircle2 /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Maintenance</h1>
          <p className="text-muted mt-1 text-sm">Track repairs and work orders across your properties.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Request
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        {statCards.map(s => (
          <Card key={s.label}>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{s.label}</span>
                <span className="text-faint [&_svg]:h-[18px] [&_svg]:w-[18px]">{s.icon}</span>
              </div>
              <div className="mt-3 font-display text-[27px] leading-none font-medium text-ink tnum">{s.value}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search by title, property, or vendor..."
            className="w-full pl-10 pr-4 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 border border-line rounded-lg bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as MaintenanceStatus | 'all')}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full min-w-[820px] sm:min-w-0">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Request</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Priority</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Cost</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Reported</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-3 px-4">
                      <p className="font-medium text-ink">{m.title}</p>
                      {m.category && <p className="text-xs text-muted capitalize">{m.category}</p>}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted">
                      {propertyName(m.propertyId)}
                      {unitNumber(m.unitId) && <span className="text-faint"> · {unitNumber(m.unitId)}</span>}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={priorityBadge[m.priority]} className="capitalize">{m.priority}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={statusBadge[m.status]}>{statusLabel[m.status]}</Badge>
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-ink tnum">
                      {m.cost ? formatCurrency(m.cost) : '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted">
                      {m.reportedDate ? formatDate(m.reportedDate) : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {m.status !== 'resolved' && m.status !== 'cancelled' && (
                          <button
                            onClick={() => quickStatus(m, m.status === 'open' ? 'in_progress' : 'resolved')}
                            className="text-xs font-medium text-primary hover:text-primary-hover px-2 py-1 rounded-md hover:bg-primary-soft transition-colors"
                          >
                            {m.status === 'open' ? 'Start' : 'Resolve'}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(m)}
                          className="p-1.5 text-faint hover:text-ink hover:bg-black/[0.05] rounded-md transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(m)}
                          className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-16">
              <Wrench className="h-10 w-10 mx-auto text-faint mb-3" />
              <h3 className="font-medium text-ink">No maintenance requests</h3>
              <p className="text-sm text-muted mt-1">Log a repair to start tracking it here.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Edit Request' : 'New Maintenance Request'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Title *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Leaking kitchen faucet"
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="What needs fixing?"
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Property</label>
              <select
                value={form.propertyId}
                onChange={e => setForm({ ...form, propertyId: e.target.value, unitId: '' })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">Select property</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Unit</label>
              <select
                value={form.unitId}
                onChange={e => setForm({ ...form, unitId: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">Select unit</option>
                {availableUnits.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface capitalize focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Priority</label>
              <select
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value as MaintenancePriority })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface capitalize focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as MaintenanceStatus })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Cost</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.cost}
                onChange={e => setForm({ ...form, cost: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Vendor</label>
              <input
                type="text"
                value={form.vendor}
                onChange={e => setForm({ ...form, vendor: e.target.value })}
                placeholder="Who's handling it?"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Reported Date</label>
              <input
                type="date"
                value={form.reportedDate}
                onChange={e => setForm({ ...form, reportedDate: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              {editingId ? 'Save Changes' : 'Create Request'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
