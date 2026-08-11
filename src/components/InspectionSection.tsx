import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, Plus, ChevronDown, ChevronUp, Pencil, Trash2,
  Eye, Check, Clock, GitCompareArrows,
} from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { formatDate, todayLocalDate } from '../lib/utils';
import { inspectionsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Inspection, InspectionType, InspectionStatus, ItemCondition } from '../types';

// ---------------------------------------------------------------------------
// Default rooms & items template
// ---------------------------------------------------------------------------
const DEFAULT_ROOMS: { key: string; label: string; items: string[] }[] = [
  { key: 'living_room', label: 'Living Room', items: ['Walls', 'Ceiling', 'Floor', 'Windows', 'Doors', 'Light fixtures', 'Outlets/Switches'] },
  { key: 'kitchen', label: 'Kitchen', items: ['Walls', 'Ceiling', 'Floor', 'Cabinets', 'Countertops', 'Sink/Faucet', 'Stove/Oven', 'Refrigerator', 'Dishwasher', 'Light fixtures'] },
  { key: 'bedroom_1', label: 'Bedroom 1', items: ['Walls', 'Ceiling', 'Floor', 'Windows', 'Doors', 'Closet', 'Light fixtures', 'Outlets/Switches'] },
  { key: 'bedroom_2', label: 'Bedroom 2', items: ['Walls', 'Ceiling', 'Floor', 'Windows', 'Doors', 'Closet', 'Light fixtures', 'Outlets/Switches'] },
  { key: 'bathroom_1', label: 'Bathroom 1', items: ['Walls', 'Ceiling', 'Floor', 'Toilet', 'Sink/Vanity', 'Bathtub/Shower', 'Mirror', 'Exhaust fan', 'Light fixtures'] },
  { key: 'bathroom_2', label: 'Bathroom 2', items: ['Walls', 'Ceiling', 'Floor', 'Toilet', 'Sink/Vanity', 'Bathtub/Shower', 'Mirror', 'Exhaust fan', 'Light fixtures'] },
  { key: 'hallway', label: 'Hallway/Entry', items: ['Walls', 'Ceiling', 'Floor', 'Doors', 'Light fixtures', 'Smoke detectors'] },
  { key: 'exterior', label: 'Exterior/Patio', items: ['Front door', 'Back door', 'Windows (exterior)', 'Patio/Balcony', 'Mailbox', 'Landscaping'] },
];

const CONDITIONS: { value: ItemCondition; label: string; color: string }[] = [
  { value: 'excellent', label: 'Excellent', color: 'text-positive' },
  { value: 'good', label: 'Good', color: 'text-primary' },
  { value: 'fair', label: 'Fair', color: 'text-warning' },
  { value: 'poor', label: 'Poor', color: 'text-danger' },
  { value: 'damaged', label: 'Damaged', color: 'text-danger font-semibold' },
  { value: 'na', label: 'N/A', color: 'text-faint' },
];

const TYPE_LABEL: Record<InspectionType, string> = {
  move_in: 'Move In',
  move_out: 'Move Out',
  periodic: 'Periodic',
};

const STATUS_BADGE: Record<InspectionStatus, 'warning' | 'success'> = {
  draft: 'warning',
  completed: 'success',
};

interface InspectionItemDraft {
  room: string;
  roomLabel: string;
  item: string;
  condition: ItemCondition;
  notes: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  tenantId: string;
  leaseId: string;
  propertyId?: string;
  unitId?: string;
}

export function InspectionSection({ tenantId, leaseId, propertyId, unitId }: Props) {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const canEdit = hasPermission('properties_edit');

  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewInspection, setViewInspection] = useState<Inspection | null>(null);

  // Create/Edit modal
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formType, setFormType] = useState<InspectionType>('move_in');
  const [formDate, setFormDate] = useState(todayLocalDate());
  const [formInspector, setFormInspector] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState<InspectionItemDraft[]>([]);
  const [formStatus, setFormStatus] = useState<InspectionStatus>('draft');
  const [saving, setSaving] = useState(false);

  // Compare modal
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState<Inspection | null>(null);
  const [compareB, setCompareB] = useState<Inspection | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Collapsed rooms in the form
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await inspectionsApi.getAll({ leaseId });
      setInspections(data);
    } catch {
      // table might not exist yet
    } finally {
      setLoading(false);
    }
  }, [leaseId]);

  useEffect(() => { load(); }, [load]);

  // Build template items from DEFAULT_ROOMS
  const buildTemplate = useCallback((): InspectionItemDraft[] => {
    const items: InspectionItemDraft[] = [];
    for (const room of DEFAULT_ROOMS) {
      for (const item of room.items) {
        items.push({ room: room.key, roomLabel: room.label, item, condition: 'good', notes: '' });
      }
    }
    return items;
  }, []);

  const openCreate = useCallback((type: InspectionType) => {
    setEditingId(null);
    setFormType(type);
    setFormDate(todayLocalDate());
    setFormInspector('');
    setFormNotes('');
    setFormStatus('draft');
    setFormItems(buildTemplate());
    setCollapsedRooms(new Set());
    setIsFormOpen(true);
  }, [buildTemplate]);

  const openEdit = useCallback(async (insp: Inspection) => {
    try {
      const full = await inspectionsApi.getById(insp.id);
      setEditingId(full.id);
      setFormType(full.type);
      setFormDate(full.inspectionDate);
      setFormInspector(full.inspectorName || '');
      setFormNotes(full.notes || '');
      setFormStatus(full.status);

      if (full.items && full.items.length > 0) {
        // Build from existing items, finding room labels
        const roomLabels = Object.fromEntries(DEFAULT_ROOMS.map(r => [r.key, r.label]));
        setFormItems(full.items.map(it => ({
          room: it.room,
          roomLabel: roomLabels[it.room] || it.room,
          item: it.item,
          condition: it.condition,
          notes: it.notes || '',
        })));
      } else {
        setFormItems(buildTemplate());
      }
      setCollapsedRooms(new Set());
      setIsFormOpen(true);
    } catch {
      showToast('Failed to load inspection details', 'error');
    }
  }, [buildTemplate, showToast]);

  const openView = useCallback(async (insp: Inspection) => {
    try {
      const full = await inspectionsApi.getById(insp.id);
      setViewInspection(full);
    } catch {
      showToast('Failed to load inspection', 'error');
    }
  }, [showToast]);

  const updateItemCondition = useCallback((idx: number, condition: ItemCondition) => {
    setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, condition } : it));
  }, []);

  const updateItemNotes = useCallback((idx: number, notes: string) => {
    setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, notes } : it));
  }, []);

  const toggleRoom = useCallback((room: string) => {
    setCollapsedRooms(prev => {
      const next = new Set(prev);
      if (next.has(room)) next.delete(room); else next.add(room);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload = {
        propertyId,
        unitId,
        leaseId,
        tenantId,
        type: formType,
        inspectionDate: formDate,
        inspectorName: formInspector || undefined,
        status: formStatus,
        notes: formNotes || undefined,
        items: formItems.map(it => ({
          room: it.room,
          item: it.item,
          condition: it.condition,
          notes: it.notes || undefined,
        })),
      };

      if (editingId) {
        await inspectionsApi.update(editingId, payload);
        showToast('Inspection updated', 'success');
      } else {
        await inspectionsApi.create(payload);
        showToast('Inspection created', 'success');
      }
      setIsFormOpen(false);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }, [editingId, propertyId, unitId, leaseId, tenantId, formType, formDate, formInspector, formStatus, formNotes, formItems, showToast, load]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await inspectionsApi.delete(deleteTarget);
      showToast('Inspection deleted', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }, [deleteTarget, showToast, load]);

  // Compare: load both inspections with items
  const openCompare = useCallback(async () => {
    const moveIn = inspections.find(i => i.type === 'move_in');
    const moveOut = inspections.find(i => i.type === 'move_out');
    if (!moveIn || !moveOut) {
      showToast('Need both a move in and move out inspection to compare', 'error');
      return;
    }
    try {
      const [a, b] = await Promise.all([
        inspectionsApi.getById(moveIn.id),
        inspectionsApi.getById(moveOut.id),
      ]);
      setCompareA(a);
      setCompareB(b);
      setCompareOpen(true);
    } catch {
      showToast('Failed to load inspections for comparison', 'error');
    }
  }, [inspections, showToast]);

  // Group items by room for display
  const groupByRoom = useCallback((items: InspectionItemDraft[] | undefined) => {
    if (!items) return [];
    const map = new Map<string, InspectionItemDraft[]>();
    for (const it of items) {
      const key = it.room;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).map(([room, roomItems]) => ({
      room,
      label: roomItems[0]?.roomLabel || room,
      items: roomItems,
    }));
  }, []);

  const formRooms = useMemo(() => groupByRoom(formItems), [formItems, groupByRoom]);

  const hasMoveIn = inspections.some(i => i.type === 'move_in');
  const hasMoveOut = inspections.some(i => i.type === 'move_out');
  const canCompare = hasMoveIn && hasMoveOut;

  if (loading) return null;

  return (
    <>
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-faint" />
              Inspections
            </h3>
            <div className="flex gap-2 flex-wrap">
              {canCompare && (
                <Button size="sm" variant="outline" onClick={openCompare}>
                  <GitCompareArrows className="h-3.5 w-3.5 mr-1" /> Compare
                </Button>
              )}
              {canEdit && (
                <div className="flex gap-1">
                  {!hasMoveIn && (
                    <Button size="sm" onClick={() => openCreate('move_in')}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Move In
                    </Button>
                  )}
                  {!hasMoveOut && (
                    <Button size="sm" onClick={() => openCreate('move_out')}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Move Out
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openCreate('periodic')}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Periodic
                  </Button>
                </div>
              )}
            </div>
          </div>

          {inspections.length === 0 ? (
            <p className="text-sm text-muted">
              No inspections recorded yet.
              {canEdit && ' Create a move in inspection to start tracking unit condition.'}
            </p>
          ) : (
            <div className="space-y-2">
              {inspections.map(insp => {
                const isExpanded = expanded === insp.id;
                return (
                  <div key={insp.id} className="border border-line rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-canvas/60 transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : insp.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={STATUS_BADGE[insp.status]}>
                          {insp.status === 'draft' ? 'Draft' : 'Complete'}
                        </Badge>
                        <span className="text-sm text-ink font-medium">
                          {TYPE_LABEL[insp.type]} Inspection
                        </span>
                        <span className="text-xs text-muted">{formatDate(insp.inspectionDate)}</span>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-line p-4 space-y-3 bg-canvas/30">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="eyebrow">Type</p>
                            <p className="text-ink">{TYPE_LABEL[insp.type]}</p>
                          </div>
                          <div>
                            <p className="eyebrow">Date</p>
                            <p className="text-ink">{formatDate(insp.inspectionDate)}</p>
                          </div>
                          {insp.inspectorName && (
                            <div>
                              <p className="eyebrow">Inspector</p>
                              <p className="text-ink">{insp.inspectorName}</p>
                            </div>
                          )}
                        </div>

                        {insp.notes && (
                          <div className="text-sm text-muted">
                            <p className="eyebrow mb-1">Notes</p>
                            <p>{insp.notes}</p>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2 border-t border-line">
                          <Button size="sm" variant="outline" onClick={() => openView(insp)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> View Checklist
                          </Button>
                          {canEdit && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openEdit(insp)}>
                                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(insp.id)}>
                                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                              </Button>
                            </>
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

      {/* Create/Edit modal with room-by-room checklist */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => !saving && setIsFormOpen(false)}
        title={editingId ? 'Edit Inspection' : `New ${TYPE_LABEL[formType]} Inspection`}
        size="xl"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Type</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formType}
                onChange={e => setFormType(e.target.value as InspectionType)}
              >
                <option value="move_in">Move In</option>
                <option value="move_out">Move Out</option>
                <option value="periodic">Periodic</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Inspector</label>
              <input
                type="text"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={formInspector}
                onChange={e => setFormInspector(e.target.value)}
                placeholder="Name"
              />
            </div>
          </div>

          {/* Status toggle */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-ink">Status:</label>
            <button
              type="button"
              onClick={() => setFormStatus(formStatus === 'draft' ? 'completed' : 'draft')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                formStatus === 'completed'
                  ? 'bg-positive-soft text-positive'
                  : 'bg-warning-soft text-warning'
              }`}
            >
              {formStatus === 'completed' ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {formStatus === 'completed' ? 'Completed' : 'Draft'}
            </button>
          </div>

          {/* Room-by-room checklist */}
          <div className="border-t border-line pt-4 space-y-3">
            <h4 className="text-sm font-semibold text-ink">Room by Room Checklist</h4>

            {formRooms.map(({ room, label, items }) => {
              const isCollapsed = collapsedRooms.has(room);
              const itemStartIdx = formItems.findIndex(it => it.room === room);
              return (
                <div key={room} className="border border-line rounded-lg overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-canvas/50 hover:bg-canvas/80 transition-colors"
                    onClick={() => toggleRoom(room)}
                  >
                    <span className="text-sm font-medium text-ink">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{items.length} items</span>
                      {isCollapsed ? <ChevronDown className="h-3.5 w-3.5 text-faint" /> : <ChevronUp className="h-3.5 w-3.5 text-faint" />}
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-line">
                      {items.map((it, localIdx) => {
                        const globalIdx = itemStartIdx + localIdx;
                        return (
                          <div key={`${room}-${it.item}`} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                            <span className="text-sm text-ink w-36 shrink-0">{it.item}</span>
                            <div className="flex gap-1 flex-wrap">
                              {CONDITIONS.map(c => (
                                <button
                                  key={c.value}
                                  type="button"
                                  onClick={() => updateItemCondition(globalIdx, c.value)}
                                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                    it.condition === c.value
                                      ? c.value === 'excellent' || c.value === 'good'
                                        ? 'bg-positive-soft text-positive ring-1 ring-positive/30'
                                        : c.value === 'fair'
                                          ? 'bg-warning-soft text-warning ring-1 ring-warning/30'
                                          : c.value === 'na'
                                            ? 'bg-canvas text-faint ring-1 ring-line'
                                            : 'bg-danger-soft text-danger ring-1 ring-danger/30'
                                      : 'bg-surface text-muted hover:bg-canvas'
                                  }`}
                                >
                                  {c.label}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink min-w-[120px]"
                              value={it.notes}
                              onChange={e => updateItemNotes(globalIdx, e.target.value)}
                              placeholder="Notes"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">General Notes</label>
            <textarea
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink min-h-[60px]"
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              placeholder="Overall condition, special notes, etc."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formDate}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Inspection'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* View inspection modal (read-only checklist) */}
      <Modal
        isOpen={!!viewInspection}
        onClose={() => setViewInspection(null)}
        title={viewInspection ? `${TYPE_LABEL[viewInspection.type]} Inspection` : ''}
        size="lg"
      >
        {viewInspection && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><p className="eyebrow">Date</p><p className="text-ink">{formatDate(viewInspection.inspectionDate)}</p></div>
              <div><p className="eyebrow">Status</p><Badge variant={STATUS_BADGE[viewInspection.status]}>{viewInspection.status === 'completed' ? 'Complete' : 'Draft'}</Badge></div>
              {viewInspection.inspectorName && <div><p className="eyebrow">Inspector</p><p className="text-ink">{viewInspection.inspectorName}</p></div>}
            </div>

            {viewInspection.items && viewInspection.items.length > 0 && (
              <div className="space-y-3">
                {(() => {
                  const roomLabels = Object.fromEntries(DEFAULT_ROOMS.map(r => [r.key, r.label]));
                  const grouped = new Map<string, typeof viewInspection.items>();
                  for (const it of viewInspection.items!) {
                    if (!grouped.has(it.room)) grouped.set(it.room, []);
                    grouped.get(it.room)!.push(it);
                  }
                  return Array.from(grouped.entries()).map(([room, items]) => (
                    <div key={room} className="border border-line rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-canvas/50 font-medium text-sm text-ink">{roomLabels[room] || room}</div>
                      <div className="divide-y divide-line">
                        {items!.map(it => {
                          const cond = CONDITIONS.find(c => c.value === it.condition);
                          return (
                            <div key={it.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                              <span className="w-36 text-ink shrink-0">{it.item}</span>
                              <span className={`text-xs font-semibold ${cond?.color || 'text-muted'}`}>{cond?.label || it.condition}</span>
                              {it.notes && <span className="text-xs text-muted flex-1 truncate">{it.notes}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {viewInspection.notes && (
              <div className="border-t border-line pt-3">
                <p className="eyebrow mb-1">Notes</p>
                <p className="text-sm text-muted">{viewInspection.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Compare modal (move-in vs move-out) */}
      <Modal isOpen={compareOpen} onClose={() => setCompareOpen(false)} title="Move In vs Move Out Comparison" size="xl">
        {compareA && compareB && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-positive-soft/50 rounded-lg p-3">
                <p className="font-semibold text-ink">Move In</p>
                <p className="text-muted">{formatDate(compareA.inspectionDate)}</p>
              </div>
              <div className="bg-warning-soft/50 rounded-lg p-3">
                <p className="font-semibold text-ink">Move Out</p>
                <p className="text-muted">{formatDate(compareB.inspectionDate)}</p>
              </div>
            </div>

            {(() => {
              const roomLabels = Object.fromEntries(DEFAULT_ROOMS.map(r => [r.key, r.label]));
              // Build lookup for move-in items
              const aMap = new Map<string, { condition: string; notes?: string }>();
              for (const it of compareA.items || []) {
                aMap.set(`${it.room}::${it.item}`, { condition: it.condition, notes: it.notes });
              }

              // Group move-out items by room
              const rooms = new Map<string, Array<{ item: string; moveIn?: { condition: string; notes?: string }; moveOut: { condition: string; notes?: string }; changed: boolean }>>();
              for (const it of compareB.items || []) {
                if (!rooms.has(it.room)) rooms.set(it.room, []);
                const moveIn = aMap.get(`${it.room}::${it.item}`);
                rooms.get(it.room)!.push({
                  item: it.item,
                  moveIn,
                  moveOut: { condition: it.condition, notes: it.notes },
                  changed: !!moveIn && moveIn.condition !== it.condition,
                });
              }

              return Array.from(rooms.entries()).map(([room, items]) => (
                <div key={room} className="border border-line rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-canvas/50 font-medium text-sm text-ink">{roomLabels[room] || room}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line bg-canvas/30">
                          <th className="text-left px-3 py-1.5 text-xs font-semibold text-muted w-36">Item</th>
                          <th className="text-center px-3 py-1.5 text-xs font-semibold text-positive">Move In</th>
                          <th className="text-center px-3 py-1.5 text-xs font-semibold text-warning">Move Out</th>
                          <th className="text-left px-3 py-1.5 text-xs font-semibold text-muted">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {items.map(row => {
                          const miCond = CONDITIONS.find(c => c.value === row.moveIn?.condition);
                          const moCond = CONDITIONS.find(c => c.value === row.moveOut.condition);
                          return (
                            <tr key={row.item} className={row.changed ? 'bg-warning-soft/20' : ''}>
                              <td className="px-3 py-1.5 text-ink">{row.item}</td>
                              <td className={`px-3 py-1.5 text-center text-xs font-semibold ${miCond?.color || 'text-muted'}`}>
                                {miCond?.label || row.moveIn?.condition || '—'}
                              </td>
                              <td className={`px-3 py-1.5 text-center text-xs font-semibold ${moCond?.color || 'text-muted'}`}>
                                {moCond?.label || row.moveOut.condition}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-muted">
                                {row.moveOut.notes || row.moveIn?.notes || ''}
                                {row.changed && <span className="ml-1 text-warning font-semibold">(changed)</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Inspection"
        message="This will permanently delete this inspection and all its checklist items. This cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
