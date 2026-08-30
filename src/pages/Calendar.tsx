import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight, List, Grid3X3,
  Check, Trash2, Edit2, X, AlertCircle, Bell, Clock, Sun, ChevronDown,
  Search, Copy, Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { calendarApi } from '../lib/api';
import { formatDate, todayLocalDate } from '../lib/utils';
import type { CalendarEvent, CalendarCategory, CalendarPriority, RecurrenceRule } from '../types';

const CATEGORY_GROUPS: { label: string; items: { value: CalendarCategory; label: string }[] }[] = [
  {
    label: 'Financial',
    items: [
      { value: 'rent_due', label: 'Rent Due' },
      { value: 'utility_due', label: 'Utility Due' },
      { value: 'mortgage', label: 'Mortgage' },
      { value: 'hoa', label: 'HOA' },
      { value: 'property_tax', label: 'Property Tax' },
      { value: 'insurance', label: 'Insurance' },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { value: 'inspection', label: 'Inspection' },
      { value: 'smoke_detector', label: 'Smoke Detector' },
      { value: 'hvac', label: 'HVAC Service' },
      { value: 'pest_control', label: 'Pest Control' },
      { value: 'lawn_care', label: 'Lawn Care' },
      { value: 'snow_removal', label: 'Snow Removal' },
      { value: 'maintenance', label: 'General Maintenance' },
      { value: 'warranty_expiration', label: 'Warranty Expiration' },
    ],
  },
  {
    label: 'Lease Management',
    items: [
      { value: 'lease_expiration', label: 'Lease Expiration' },
      { value: 'lease_renewal', label: 'Lease Renewal' },
      { value: 'lease_termination', label: 'Lease Termination' },
      { value: 'move_in', label: 'Move In' },
      { value: 'move_out', label: 'Move Out' },
    ],
  },
  {
    label: 'Personal & Administrative',
    items: [
      { value: 'birthday', label: 'Birthday' },
      { value: 'personal', label: 'Personal' },
      { value: 'contractor', label: 'Contractor' },
      { value: 'vendor', label: 'Vendor' },
      { value: 'licensing', label: 'Licensing' },
      { value: 'city_inspection', label: 'City Inspection' },
      { value: 'custom', label: 'Custom' },
    ],
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  rent_due: 'bg-emerald-100 text-emerald-800',
  utility_due: 'bg-blue-100 text-blue-800',
  mortgage: 'bg-indigo-100 text-indigo-800',
  hoa: 'bg-violet-100 text-violet-800',
  property_tax: 'bg-amber-100 text-amber-800',
  insurance: 'bg-sky-100 text-sky-800',
  inspection: 'bg-orange-100 text-orange-800',
  smoke_detector: 'bg-red-100 text-red-800',
  hvac: 'bg-cyan-100 text-cyan-800',
  pest_control: 'bg-lime-100 text-lime-800',
  lawn_care: 'bg-green-100 text-green-800',
  snow_removal: 'bg-slate-100 text-slate-800',
  maintenance: 'bg-yellow-100 text-yellow-800',
  lease_expiration: 'bg-rose-100 text-rose-800',
  lease_renewal: 'bg-teal-100 text-teal-800',
  lease_termination: 'bg-red-100 text-red-800',
  move_in: 'bg-emerald-100 text-emerald-800',
  move_out: 'bg-pink-100 text-pink-800',
  birthday: 'bg-pink-100 text-pink-800',
  personal: 'bg-violet-100 text-violet-800',
  contractor: 'bg-fuchsia-100 text-fuchsia-800',
  vendor: 'bg-purple-100 text-purple-800',
  licensing: 'bg-gray-100 text-gray-800',
  city_inspection: 'bg-amber-100 text-amber-800',
  warranty_expiration: 'bg-orange-100 text-orange-800',
  custom: 'bg-stone-100 text-stone-800',
};

/** Solid background colors for week-view blocks */
const CATEGORY_BG: Record<string, string> = {
  rent_due: '#d1fae5', utility_due: '#dbeafe', mortgage: '#e0e7ff',
  hoa: '#ede9fe', property_tax: '#fef3c7', insurance: '#e0f2fe',
  inspection: '#ffedd5', smoke_detector: '#fee2e2', hvac: '#cffafe',
  pest_control: '#ecfccb', lawn_care: '#dcfce7', snow_removal: '#f1f5f9',
  maintenance: '#fef9c3', lease_expiration: '#ffe4e6', lease_renewal: '#ccfbf1',
  lease_termination: '#fee2e2', move_in: '#d1fae5', move_out: '#fce7f3',
  birthday: '#fce7f3', personal: '#ede9fe', contractor: '#fae8ff',
  vendor: '#f3e8ff', licensing: '#f3f4f6', city_inspection: '#fef3c7',
  warranty_expiration: '#ffedd5', custom: '#f5f5f4',
};

/** Categories that represent date-based events (informational). They cannot be
 *  marked complete and never appear in the overdue "Past Activity" section. */
const EVENT_CATEGORIES = new Set<CalendarCategory>([
  'birthday', 'move_in', 'move_out',
  'lease_expiration', 'lease_renewal', 'lease_termination',
  'warranty_expiration',
]);

/** Returns true when the item is an informational event rather than a
 *  completable task. Auto-generated items are always events. */
function isEventOnly(e: { category: CalendarCategory; isAuto?: boolean }): boolean {
  return !!e.isAuto || EVENT_CATEGORIES.has(e.category);
}

const PRIORITY_BADGE: Record<CalendarPriority, { variant: 'default' | 'warning' | 'destructive'; label: string }> = {
  low: { variant: 'default', label: 'Low' },
  medium: { variant: 'default', label: 'Medium' },
  high: { variant: 'warning', label: 'High' },
  urgent: { variant: 'destructive', label: 'Urgent' },
};

function categoryLabel(cat: CalendarCategory): string {
  for (const group of CATEGORY_GROUPS) {
    const match = group.items.find(i => i.value === cat);
    if (match) return match.label;
  }
  return cat.replace(/_/g, ' ');
}

/** Format "14:30" → "2:30 PM", "09:00" → "9:00 AM" */
function formatTime12(time: string): string {
  const [hStr, mStr] = time.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

function daysFromNow(dateStr: string): number {
  const today = new Date(todayLocalDate() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annually: 'Semi Annually',
  annually: 'Annually',
};

function addRecurrenceInterval(date: Date, rule: RecurrenceRule): Date {
  const d = new Date(date);
  switch (rule) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'semi_annually': d.setMonth(d.getMonth() + 6); break;
    case 'annually': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/** Get the week (Sun–Sat) containing a given date */
function getWeekDates(d: Date): Date[] {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

interface ExpandedEvent extends CalendarEvent {
  isVirtual?: boolean;
  sourceEventId?: string;
}

function expandRecurringEvents(events: CalendarEvent[], windowStart: string, windowEnd: string): ExpandedEvent[] {
  const result: ExpandedEvent[] = [];
  const startDate = new Date(windowStart + 'T00:00:00');
  const endDate = new Date(windowEnd + 'T00:00:00');

  for (const event of events) {
    if (!event.isRecurring || !event.recurrenceRule || event.completed) {
      if (event.eventDate >= windowStart && event.eventDate <= windowEnd) {
        result.push(event);
      }
      continue;
    }

    let cursor = new Date(event.eventDate + 'T00:00:00');
    const maxOccurrences = event.recurrenceRule === 'daily' ? 400 : 100;
    let count = 0;

    while (cursor <= endDate && count < maxOccurrences) {
      if (cursor >= startDate) {
        const dateStr = toDateStr(cursor);
        if (dateStr === event.eventDate) {
          result.push(event);
        } else {
          result.push({
            ...event,
            eventDate: dateStr,
            isVirtual: true,
            sourceEventId: event.id,
            id: `${event.id}__${dateStr}`,
          });
        }
      }
      cursor = addRecurrenceInterval(cursor, event.recurrenceRule);
      count++;
    }
  }

  return result;
}

/** Reusable multi-select checkbox dropdown */
function MultiCheckSelect({ label, options, selected, onChange, allLabel = 'All' }: {
  label: string;
  options: { id: string; name: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allSelected = selected.size === 0 || selected.size === options.length;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  const toggleAll = () => {
    onChange(allSelected ? new Set() : new Set(options.map(o => o.id)));
  };

  const displayLabel = allSelected
    ? allLabel
    : selected.size === 1
      ? (options.find(o => selected.has(o.id))?.name ?? `1 ${label}`)
      : `${selected.size} ${label}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-sm border border-line rounded-lg px-3 py-1.5 bg-surface text-ink flex items-center gap-2 min-w-[160px]"
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronLeft className={`h-3.5 w-3.5 transition-transform flex-shrink-0 ${open ? 'rotate-90' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-surface border border-line rounded-lg shadow-lg py-1 min-w-[220px] max-h-[260px] overflow-y-auto">
          <button
            type="button"
            onClick={toggleAll}
            className="w-full text-left px-3 py-2 text-sm hover:bg-canvas flex items-center gap-2"
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${allSelected ? 'bg-primary border-primary text-white' : 'border-line'}`}>
              {allSelected && <Check className="h-3 w-3" />}
            </span>
            {allLabel}
          </button>
          <div className="border-t border-line my-1" />
          {options.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-canvas flex items-center gap-2"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${selected.has(o.id) ? 'bg-primary border-primary text-white' : 'border-line'}`}>
                {selected.has(o.id) && <Check className="h-3 w-3" />}
              </span>
              <span className="truncate">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FormState {
  title: string;
  description: string;
  category: CalendarCategory;
  eventDate: string;
  endDate: string;
  eventTime: string;
  endTime: string;
  priority: CalendarPriority;
  isRecurring: boolean;
  recurrenceRule: RecurrenceRule | '';
  propertyIds: Set<string>;
  unitId: string;
  notes: string;
  reminderHours: string;
  visibility: 'shared' | 'personal';
}

const EMPTY_FORM: FormState = {
  title: '', description: '', category: 'custom',
  eventDate: '', endDate: '', eventTime: '', endTime: '', priority: 'medium',
  isRecurring: false, recurrenceRule: '',
  propertyIds: new Set(), unitId: '', notes: '',
  reminderHours: '', visibility: 'shared',
};

/** WEEK VIEW: hours from 6 AM to 9 PM */
const WEEK_HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6..21

/** Parse "HH:MM" to fractional hours */
function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

export function Calendar() {
  const { properties, units } = useApp();
  const { showToast } = useToast();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'calendar' | 'week' | 'agenda' | 'today'>('calendar');
  const [showPastActivity, setShowPastActivity] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<CalendarCategory | ''>('');
  const [filterProperties, setFilterProperties] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [previewEvent, setPreviewEvent] = useState<ExpandedEvent | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Week view state: the Date anchoring the week
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  const loadEvents = useCallback(async () => {
    try {
      const data = await calendarApi.list();
      setEvents(data);
    } catch { /* silently fail */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Close preview popup on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (previewRef.current && !previewRef.current.contains(e.target as Node)) {
        setPreviewEvent(null);
      }
    };
    if (previewEvent) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [previewEvent]);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (filterCategory) result = result.filter(e => e.category === filterCategory);
    if (filterProperties.size > 0) {
      result = result.filter(e => {
        const pids = e.propertyIds ?? (e.propertyId ? [e.propertyId] : []);
        if (pids.length === 0) return true;
        return pids.some(pid => filterProperties.has(pid));
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q) ||
        categoryLabel(e.category).toLowerCase().includes(q)
      );
    }
    return result;
  }, [events, filterCategory, filterProperties, searchQuery]);

  const calendarWindowStart = useMemo(() =>
    `${currentYear}-${pad2(currentMonth + 1)}-01`,
  [currentYear, currentMonth]);

  const calendarWindowEnd = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    return `${currentYear}-${pad2(currentMonth + 1)}-${pad2(daysInMonth)}`;
  }, [currentYear, currentMonth]);

  const expandedCalendarEvents = useMemo(() =>
    expandRecurringEvents(filteredEvents, calendarWindowStart, calendarWindowEnd),
  [filteredEvents, calendarWindowStart, calendarWindowEnd]);

  const eventsForDate = useCallback((dateStr: string) =>
    expandedCalendarEvents.filter(e => {
      if (e.eventDate === dateStr) return true;
      // Multi-day: show on every day between eventDate and endDate
      if (e.endDate && dateStr > e.eventDate && dateStr <= e.endDate) return true;
      return false;
    }),
  [expandedCalendarEvents]);

  const today = todayLocalDate();

  // Week view dates and events
  const weekDates = useMemo(() => getWeekDates(weekAnchor), [weekAnchor]);
  const weekStart = useMemo(() => toDateStr(weekDates[0]), [weekDates]);
  const weekEnd = useMemo(() => toDateStr(weekDates[6]), [weekDates]);
  const expandedWeekEvents = useMemo(() =>
    expandRecurringEvents(filteredEvents, weekStart, weekEnd),
  [filteredEvents, weekStart, weekEnd]);
  const weekEventsForDate = useCallback((dateStr: string) =>
    expandedWeekEvents.filter(e => {
      if (e.eventDate === dateStr) return true;
      if (e.endDate && dateStr > e.eventDate && dateStr <= e.endDate) return true;
      return false;
    }),
  [expandedWeekEvents]);

  const agendaWindowEnd = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 1);
    return toDateStr(d);
  }, [today]);

  const expandedAgendaEvents = useMemo(() =>
    expandRecurringEvents(filteredEvents, today, agendaWindowEnd),
  [filteredEvents, today, agendaWindowEnd]);

  const upcomingEvents = useMemo(() =>
    expandedAgendaEvents
      .filter(e => !e.completed && e.eventDate >= today)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
      .slice(0, 50),
  [expandedAgendaEvents, today]);

  const overdueEvents = useMemo(() =>
    filteredEvents
      .filter(e => !e.completed && !e.isRecurring && e.eventDate < today && !isEventOnly(e))
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
  [filteredEvents, today]);

  // Today's events: everything on today's date (including recurring occurrences).
  const todayEvents = useMemo(() =>
    expandedAgendaEvents
      .filter(e => e.eventDate === today)
      .sort((a, b) => {
        if (a.eventTime && b.eventTime) return a.eventTime.localeCompare(b.eventTime);
        if (a.eventTime) return -1;
        if (b.eventTime) return 1;
        return a.title.localeCompare(b.title);
      }),
  [expandedAgendaEvents, today]);

  const formPropertyIds = form.propertyIds;
  const propertyUnits = useMemo(() => {
    if (formPropertyIds.size === 1) {
      const pid = [...formPropertyIds][0];
      return units.filter(u => u.propertyId === pid);
    }
    return [];
  }, [units, formPropertyIds]);

  const openNew = (date?: string, time?: string) => {
    setEditingEvent(null);
    setForm({
      ...EMPTY_FORM,
      eventDate: date || todayLocalDate(),
      endDate: '',
      eventTime: time || '',
      endTime: '',
      propertyIds: new Set(),
      visibility: 'shared',
    });
    setShowModal(true);
    setPreviewEvent(null);
  };

  const openEdit = (event: ExpandedEvent) => {
    if (event.isAuto) return;
    const source = event.isVirtual
      ? events.find(e => e.id === event.sourceEventId) || event
      : event;
    setEditingEvent(source);
    const pids = source.propertyIds ?? (source.propertyId ? [source.propertyId] : []);
    setForm({
      title: source.title,
      description: source.description || '',
      category: source.category,
      eventDate: source.eventDate,
      endDate: source.endDate || '',
      eventTime: source.eventTime || '',
      endTime: source.endTime || '',
      priority: source.priority,
      isRecurring: source.isRecurring,
      recurrenceRule: source.recurrenceRule || '',
      propertyIds: new Set(pids),
      unitId: source.unitId || '',
      notes: source.notes || '',
      reminderHours: source.reminderHours != null ? String(source.reminderHours) : '',
      visibility: source.visibility || 'shared',
    });
    setShowModal(true);
    setPreviewEvent(null);
  };

  /** Duplicate: pre-fill the create form with an existing event's data */
  const openDuplicate = (event: ExpandedEvent) => {
    const source = event.isVirtual
      ? events.find(e => e.id === event.sourceEventId) || event
      : event;
    const pids = source.propertyIds ?? (source.propertyId ? [source.propertyId] : []);
    setEditingEvent(null);
    setForm({
      title: source.title,
      description: source.description || '',
      category: source.category,
      eventDate: todayLocalDate(),
      endDate: '',
      eventTime: source.eventTime || '',
      endTime: source.endTime || '',
      priority: source.priority,
      isRecurring: source.isRecurring,
      recurrenceRule: source.recurrenceRule || '',
      propertyIds: new Set(pids),
      unitId: source.unitId || '',
      notes: source.notes || '',
      reminderHours: source.reminderHours != null ? String(source.reminderHours) : '',
      visibility: source.visibility || 'shared',
    });
    setShowModal(true);
    setPreviewEvent(null);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.eventDate) return;
    setSaving(true);
    try {
      const pids = [...form.propertyIds];
      const payload = {
        title: form.title,
        description: form.description || undefined,
        category: form.category,
        eventDate: form.eventDate,
        endDate: form.endDate || undefined,
        eventTime: form.eventTime || undefined,
        endTime: form.endTime || undefined,
        priority: form.priority,
        isRecurring: form.isRecurring,
        recurrenceRule: form.isRecurring && form.recurrenceRule ? form.recurrenceRule : undefined,
        propertyIds: pids,
        propertyId: pids[0] || undefined,
        unitId: form.unitId || undefined,
        notes: form.notes || undefined,
        reminderHours: form.reminderHours ? Number(form.reminderHours) : undefined,
        visibility: form.visibility,
      };
      if (editingEvent) {
        await calendarApi.update(editingEvent.id, payload);
        showToast('Event updated', 'success');
      } else {
        await calendarApi.create(payload);
        showToast('Event created', 'success');
      }
      setShowModal(false);
      await loadEvents();
    } catch {
      showToast('Failed to save event', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await calendarApi.delete(id);
      showToast('Event deleted', 'success');
      setPreviewEvent(null);
      await loadEvents();
    } catch {
      showToast('Failed to delete event', 'error');
    }
  };

  const handleToggleComplete = async (event: ExpandedEvent) => {
    if (event.isVirtual || isEventOnly(event)) return;
    try {
      await calendarApi.update(event.id, { ...event, completed: !event.completed });
      showToast(event.completed ? 'Marked as incomplete' : 'Marked as complete', 'success');
      await loadEvents();
    } catch {
      showToast('Failed to update event', 'error');
    }
  };

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };
  const goToday = () => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
    setWeekAnchor(now);
  };
  const prevWeek = () => setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  const nextWeek = () => setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });

  const propertyOptions = useMemo(() =>
    properties.map(p => ({ id: p.id, name: p.name || p.address })),
  [properties]);

  const eventPropertyNames = useCallback((event: CalendarEvent): string | null => {
    const pids = event.propertyIds ?? (event.propertyId ? [event.propertyId] : []);
    if (pids.length === 0) return null;
    return pids.map(pid => {
      const p = properties.find(pr => pr.id === pid);
      return p ? (p.name || p.address) : '';
    }).filter(Boolean).join(', ');
  }, [properties]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="flex justify-between items-center">
          <div className="h-8 w-40 bg-line/60 animate-pulse rounded" />
          <div className="h-9 w-28 bg-line/60 animate-pulse rounded-lg" />
        </div>
        <div className="grid grid-cols-7 gap-px bg-line rounded-xl overflow-hidden">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="bg-surface h-20 p-2">
              <div className="h-4 w-5 bg-line/60 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /** Event detail preview popup */
  const renderPreviewPopup = () => {
    if (!previewEvent) return null;
    const event = previewEvent;
    const propNames = eventPropertyNames(event);
    const pb = PRIORITY_BADGE[event.priority];
    return (
      <div className="fixed inset-0 z-40" onClick={() => setPreviewEvent(null)}>
        <div
          ref={previewRef}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-line rounded-xl shadow-2xl w-[340px] max-w-[90vw] overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className={`h-2 ${CATEGORY_COLORS[event.category]?.split(' ')[0] || 'bg-gray-100'}`} />
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-ink leading-tight">{event.title}</h3>
              <button onClick={() => setPreviewEvent(null)} className="p-1 rounded hover:bg-canvas flex-shrink-0">
                <X className="h-4 w-4 text-muted" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[event.category] || 'bg-gray-100'}`}>
                {categoryLabel(event.category)}
              </span>
              <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${
                isEventOnly(event) ? 'text-muted bg-canvas' : 'text-primary bg-primary-soft'
              }`}>{isEventOnly(event) ? 'Event' : 'Task'}</span>
              {event.isAuto && (
                <span className="text-[10px] text-primary bg-primary-soft rounded px-1.5 py-0.5 font-medium">Auto</span>
              )}
              {event.visibility === 'personal' && (
                <span className="text-[10px] text-violet-700 bg-violet-100 rounded px-1.5 py-0.5 font-medium">🔒 Personal</span>
              )}
              {event.priority !== 'medium' && !isEventOnly(event) && (
                <Badge variant={pb.variant}>{pb.label}</Badge>
              )}
            </div>

            <div className="space-y-1.5 text-sm text-muted">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{formatDate(event.eventDate)}</span>
                {event.endDate && <span>to {formatDate(event.endDate)}</span>}
              </div>
              {event.eventTime && (
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-ink font-medium">{formatTime12(event.eventTime)}</span>
                  {event.endTime && <span className="text-ink font-medium">to {formatTime12(event.endTime)}</span>}
                </div>
              )}
              {propNames && (
                <div className="flex items-center gap-2">
                  <span className="text-xs">📍</span>
                  <span>{propNames}</span>
                </div>
              )}
              {event.isRecurring && event.recurrenceRule && (
                <div className="flex items-center gap-2">
                  <span className="text-xs">🔄</span>
                  <span>{RECURRENCE_LABELS[event.recurrenceRule]}</span>
                </div>
              )}
              {event.reminderHours != null && (
                <div className="flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{event.reminderHours}h before</span>
                </div>
              )}
            </div>

            {event.description && (
              <p className="text-sm text-muted border-t border-line pt-2">{event.description}</p>
            )}
            {event.notes && (
              <p className="text-xs text-muted italic">{event.notes}</p>
            )}

            <div className="flex items-center gap-2 pt-1 border-t border-line">
              {!event.isAuto && (
                <>
                  <button
                    onClick={() => openEdit(event)}
                    className="flex-1 px-3 py-1.5 text-sm font-medium text-primary bg-primary-soft rounded-lg hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5"
                  ><Edit2 className="h-3.5 w-3.5" /> Edit</button>
                  <button
                    onClick={() => openDuplicate(event)}
                    className="px-3 py-1.5 text-sm font-medium text-muted bg-canvas rounded-lg hover:bg-line transition-colors flex items-center gap-1.5"
                  ><Copy className="h-3.5 w-3.5" /> Duplicate</button>
                </>
              )}
              {!isEventOnly(event) && !event.isVirtual && (
                <button
                  onClick={() => { handleToggleComplete(event); setPreviewEvent(null); }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                    event.completed ? 'text-warning bg-warning/10' : 'text-emerald-700 bg-emerald-50'
                  }`}
                >{event.completed ? 'Undo' : <><Check className="h-3.5 w-3.5" /> Done</>}</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /** Show preview on single click, edit on double click */
  const handleEventClick = (e: React.MouseEvent, event: ExpandedEvent) => {
    e.stopPropagation();
    setPreviewEvent(event);
  };

  /** Shared event row for Today/Agenda views */
  const renderEventRow = (event: CalendarEvent, showDate = false) => {
    const propNames = eventPropertyNames(event);
    const pb = PRIORITY_BADGE[event.priority];
    const expanded = event as ExpandedEvent;
    const days = showDate ? daysFromNow(event.eventDate) : 0;
    return (
      <div key={event.id + (expanded.isVirtual ? `-v` : '')} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-canvas/60">
        {isEventOnly(event) ? (
          <div className="w-5 h-5 rounded-full bg-canvas flex-shrink-0 flex items-center justify-center text-muted">
            <CalendarIcon className="h-3 w-3" />
          </div>
        ) : (
          <button
            onClick={() => handleToggleComplete(expanded)}
            disabled={expanded.isVirtual}
            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
              event.completed
                ? 'bg-primary border-primary text-white'
                : expanded.isVirtual
                  ? 'border-line/50 cursor-not-allowed'
                  : 'border-line hover:border-primary'
            }`}
          >
            {event.completed && <Check className="h-3 w-3" />}
          </button>
        )}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={ev => handleEventClick(ev, expanded)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${event.completed ? 'line-through text-muted' : 'text-ink'}`}>
              {event.title}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[event.category] || 'bg-gray-100'}`}>
              {categoryLabel(event.category)}
            </span>
            <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${
              isEventOnly(event) ? 'text-muted bg-canvas' : 'text-primary bg-primary-soft'
            }`}>{isEventOnly(event) ? 'Event' : 'Task'}</span>
            {event.isAuto && (
              <span className="text-[10px] text-primary bg-primary-soft rounded px-1.5 py-0.5 font-medium">Auto</span>
            )}
            {event.visibility === 'personal' && (
              <span className="text-[10px] text-violet-700 bg-violet-100 rounded px-1.5 py-0.5 font-medium">🔒</span>
            )}
            {event.priority !== 'medium' && !isEventOnly(event) && (
              <Badge variant={pb.variant}>{pb.label}</Badge>
            )}
            {event.isRecurring && (
              <span className="text-[10px] text-muted bg-canvas rounded px-1.5 py-0.5">
                {event.recurrenceRule ? RECURRENCE_LABELS[event.recurrenceRule] : 'Recurring'}
              </span>
            )}
            {event.reminderHours != null && <Bell className="h-3 w-3 text-muted" />}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
            {showDate && <span>{formatDate(event.eventDate)}</span>}
            {event.endDate && <span>to {formatDate(event.endDate)}</span>}
            {event.eventTime ? (
              <span className="flex items-center gap-1 font-medium text-ink">
                <Clock className="h-3 w-3" />
                {formatTime12(event.eventTime)}
                {event.endTime && <span>to {formatTime12(event.endTime)}</span>}
              </span>
            ) : !showDate ? (
              <span className="text-xs">All day</span>
            ) : null}
            {showDate && days === 0 && <span className="text-primary font-medium">Today</span>}
            {showDate && days === 1 && <span className="text-primary font-medium">Tomorrow</span>}
            {showDate && days > 1 && days <= 7 && <span className="text-warning font-medium">In {days} days</span>}
            {propNames && <span>· {propNames}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={ev => handleEventClick(ev, expanded)}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"
            title="Preview"
          ><Eye className="h-3.5 w-3.5" /></button>
          {!event.isAuto && !expanded.isVirtual && (
            <button
              onClick={() => handleDelete(event.id)}
              className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger-soft transition-colors"
            ><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="eyebrow">Schedule</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-line bg-surface p-1 inline-flex text-xs">
            {([['today', 'Today', Sun], ['week', 'Week', List], ['calendar', 'Month', Grid3X3], ['agenda', 'Agenda', CalendarIcon]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all font-medium ${view === key ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-ink'}`}
                onClick={() => setView(key as typeof view)}
              ><Icon className="h-3.5 w-3.5" /> {label}</button>
            ))}
          </div>
          <button
            onClick={() => openNew()}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 items-start">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search events..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-canvas"
            ><X className="h-3.5 w-3.5 text-muted" /></button>
          )}
        </div>

        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value as CalendarCategory | '')}
          className="text-sm border border-line rounded-lg px-3 py-1.5 bg-surface text-ink"
        >
          <option value="">All Categories</option>
          {CATEGORY_GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>

        <MultiCheckSelect
          label="Properties"
          allLabel="All Properties"
          options={propertyOptions}
          selected={filterProperties}
          onChange={setFilterProperties}
        />
      </div>

      {/* Past Activity */}
      {overdueEvents.length > 0 && (
        <Card className="border-danger/30">
          <button
            type="button"
            onClick={() => setShowPastActivity(p => !p)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              <span className="font-semibold text-ink">
                Past Activity ({overdueEvents.length})
              </span>
              <span className="text-xs text-danger font-medium">
                {overdueEvents.length} {overdueEvents.length === 1 ? 'task' : 'tasks'} to complete
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted transition-transform ${showPastActivity ? 'rotate-180' : ''}`} />
          </button>
          {showPastActivity && (
            <CardContent className="p-0 border-t border-line">
              <div className="divide-y divide-line">
                {overdueEvents.map(event => {
                  const propNames = eventPropertyNames(event);
                  return (
                    <div key={event.id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                      <button
                        onClick={() => handleToggleComplete(event as ExpandedEvent)}
                        className="w-5 h-5 rounded border-2 border-line hover:border-primary flex-shrink-0 flex items-center justify-center transition-colors"
                      >
                        {event.completed && <Check className="h-3 w-3" />}
                      </button>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={ev => handleEventClick(ev, event as ExpandedEvent)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-ink">{event.title}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[event.category] || 'bg-gray-100'}`}>
                            {categoryLabel(event.category)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                          <span className="text-danger font-medium">{formatDate(event.eventDate)}</span>
                          {event.eventTime && <span>{formatTime12(event.eventTime)}</span>}
                          {propNames && <span>· {propNames}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={ev => handleEventClick(ev, event as ExpandedEvent)}
                          className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"
                        ><Eye className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {view === 'today' ? (
        /* Today View */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <Sun className="h-5 w-5 text-primary" />
              </div>
              Today &mdash; {formatDate(today)}
              {todayEvents.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted">({todayEvents.length} {todayEvents.length === 1 ? 'event' : 'events'})</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {todayEvents.length === 0 ? (
              <p className="text-center text-sm text-muted py-12">Nothing scheduled for today. Enjoy your day!</p>
            ) : (
              <div className="border-t border-line divide-y divide-line">
                {todayEvents.map(event => renderEventRow(event, false))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : view === 'week' ? (
        /* Week View */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-canvas transition-colors">
                  <ChevronLeft className="h-5 w-5 text-muted" />
                </button>
                <h2 className="text-lg font-semibold text-ink min-w-[260px] text-center">
                  {MONTH_NAMES[weekDates[0].getMonth()]} {weekDates[0].getDate()} &ndash; {
                    weekDates[0].getMonth() !== weekDates[6].getMonth()
                      ? `${MONTH_NAMES[weekDates[6].getMonth()]} `
                      : ''
                  }{weekDates[6].getDate()}, {weekDates[6].getFullYear()}
                </h2>
                <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-canvas transition-colors">
                  <ChevronRight className="h-5 w-5 text-muted" />
                </button>
              </div>
              <button onClick={goToday} className="text-xs text-primary font-medium hover:underline">Today</button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Day headers */}
              <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-line">
                <div className="py-2" />
                {weekDates.map((d, i) => {
                  const dateStr = toDateStr(d);
                  const isToday = dateStr === today;
                  return (
                    <div key={i} className={`py-2 text-center border-l border-line ${isToday ? 'bg-primary-soft' : ''}`}>
                      <div className="text-xs font-medium text-muted uppercase">{DAY_NAMES[i]}</div>
                      <div className={`text-sm font-semibold mt-0.5 ${isToday ? 'text-primary' : 'text-ink'}`}>{d.getDate()}</div>
                    </div>
                  );
                })}
              </div>

              {/* All-day row */}
              {(() => {
                const allDayByDate = weekDates.map(d => {
                  const dateStr = toDateStr(d);
                  return weekEventsForDate(dateStr).filter(e => !e.eventTime);
                });
                const hasAnyAllDay = allDayByDate.some(arr => arr.length > 0);
                if (!hasAnyAllDay) return null;
                return (
                  <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-line bg-canvas/40">
                    <div className="py-1 px-1 text-[10px] text-muted flex items-start justify-end pr-2 pt-2">all day</div>
                    {allDayByDate.map((dayEvents, i) => (
                      <div
                        key={i}
                        className="border-l border-line p-0.5 min-h-[28px] cursor-pointer hover:bg-canvas/60"
                        onClick={() => openNew(toDateStr(weekDates[i]))}
                      >
                        {dayEvents.slice(0, 3).map(e => (
                          <button
                            key={e.id}
                            onClick={ev => { ev.stopPropagation(); handleEventClick(ev, e); }}
                            className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate block mb-0.5 ${
                              e.completed ? 'line-through opacity-50' : ''
                            } ${e.isAuto ? 'border border-dashed border-current/30 ' : ''}${CATEGORY_COLORS[e.category] || 'bg-gray-100 text-gray-800'}`}
                          >
                            {e.isAuto ? '✦ ' : ''}{e.title}
                          </button>
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[9px] text-muted px-1">+{dayEvents.length - 3}</span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Time grid */}
              <div className="relative">
                {WEEK_HOURS.map(hour => (
                  <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-line/50 h-[48px]">
                    <div className="text-[10px] text-muted text-right pr-2 -translate-y-2">
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </div>
                    {weekDates.map((d, i) => {
                      const dateStr = toDateStr(d);
                      const isToday = dateStr === today;
                      return (
                        <div
                          key={i}
                          className={`border-l border-line/50 cursor-pointer hover:bg-primary/5 transition-colors ${isToday ? 'bg-primary/[0.02]' : ''}`}
                          onClick={() => openNew(dateStr, `${pad2(hour)}:00`)}
                        />
                      );
                    })}
                  </div>
                ))}

                {/* Positioned timed events */}
                {weekDates.map((d, colIndex) => {
                  const dateStr = toDateStr(d);
                  const timedEvents = weekEventsForDate(dateStr).filter(e => e.eventTime);
                  return timedEvents.map(e => {
                    const startHour = timeToHours(e.eventTime!);
                    const endHour = e.endTime ? timeToHours(e.endTime) : startHour + 1;
                    const topOffset = (startHour - WEEK_HOURS[0]) * 48;
                    const height = Math.max((endHour - startHour) * 48, 20);
                    // Skip events outside visible range
                    if (startHour >= WEEK_HOURS[WEEK_HOURS.length - 1] + 1 || endHour <= WEEK_HOURS[0]) return null;
                    const leftPercent = ((colIndex + 1) / 8) * 100;
                    const widthPercent = (1 / 8) * 100;
                    return (
                      <button
                        key={e.id}
                        onClick={ev => handleEventClick(ev, e)}
                        className="absolute rounded px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden text-left border border-white/50 hover:opacity-90 transition-opacity"
                        style={{
                          top: `${topOffset}px`,
                          height: `${height}px`,
                          left: `calc(${leftPercent}% + 2px)`,
                          width: `calc(${widthPercent}% - 4px)`,
                          backgroundColor: CATEGORY_BG[e.category] || '#f5f5f4',
                          zIndex: 10,
                        }}
                      >
                        <span className="font-medium block truncate">{e.title}</span>
                        <span className="text-[9px] opacity-70 block truncate">
                          {formatTime12(e.eventTime!)}
                          {e.endTime && ` to ${formatTime12(e.endTime)}`}
                        </span>
                      </button>
                    );
                  });
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : view === 'calendar' ? (
        /* Calendar Grid (Month) */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-canvas transition-colors">
                  <ChevronLeft className="h-5 w-5 text-muted" />
                </button>
                <h2 className="text-lg font-semibold text-ink min-w-[180px] text-center">
                  {MONTH_NAMES[currentMonth]} {currentYear}
                </h2>
                <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-canvas transition-colors">
                  <ChevronRight className="h-5 w-5 text-muted" />
                </button>
              </div>
              <button onClick={goToday} className="text-xs text-primary font-medium hover:underline">Today</button>
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-2">
            <div className="grid grid-cols-7 border-b border-line">
              {DAY_NAMES.map(d => (
                <div key={d} className="py-2 text-center text-xs font-medium text-muted uppercase tracking-wide">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {(() => {
                const daysInMonth = getDaysInMonth(currentYear, currentMonth);
                const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
                const cells: React.ReactNode[] = [];

                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} className="min-h-[80px] sm:min-h-[100px] border-b border-r border-line bg-canvas/40" />);
                }

                for (let day = 1; day <= daysInMonth; day++) {
                  const dateStr = `${currentYear}-${pad2(currentMonth + 1)}-${pad2(day)}`;
                  const dayEvents = eventsForDate(dateStr);
                  const isToday = dateStr === today;

                  cells.push(
                    <div
                      key={day}
                      className="min-h-[80px] sm:min-h-[100px] border-b border-r border-line p-1 cursor-pointer hover:bg-canvas/60 transition-colors"
                      onClick={() => openNew(dateStr)}
                    >
                      <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-primary text-white' : 'text-muted'
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map(e => (
                          <button
                            key={e.id}
                            onClick={ev => { ev.stopPropagation(); handleEventClick(ev, e); }}
                            className={`w-full text-left text-[10px] sm:text-xs px-1.5 py-0.5 rounded truncate block ${
                              e.completed ? 'line-through opacity-50' : ''
                            } ${e.isAuto ? 'border border-dashed border-current/30 ' : ''}${CATEGORY_COLORS[e.category] || 'bg-gray-100 text-gray-800'}`}
                          >
                            {e.isAuto ? '✦ ' : ''}{e.eventTime ? `${formatTime12(e.eventTime)} ` : ''}{e.title}
                          </button>
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] text-muted px-1">+{dayEvents.length - 3} more</span>
                        )}
                      </div>
                    </div>
                  );
                }

                const remaining = 7 - (cells.length % 7);
                if (remaining < 7) {
                  for (let i = 0; i < remaining; i++) {
                    cells.push(<div key={`trail-${i}`} className="min-h-[80px] sm:min-h-[100px] border-b border-r border-line bg-canvas/40" />);
                  }
                }

                return cells;
              })()}
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Agenda / List View */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <CalendarIcon className="h-5 w-5 text-primary" />
              </div>
              Upcoming Events ({upcomingEvents.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {upcomingEvents.length === 0 ? (
              <p className="text-center text-sm text-muted py-12">No upcoming events. Click "New" to create one.</p>
            ) : (
              <div className="border-t border-line divide-y divide-line">
                {upcomingEvents.map(event => renderEventRow(event, true))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Event Preview Popup */}
      {renderPreviewPopup()}

      {/* Event Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col modal-enter">
            <div className="flex items-center justify-between p-5 border-b border-line shrink-0">
              <h2 className="text-lg font-semibold text-ink">
                {editingEvent ? 'Edit Event' : 'New Event'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-canvas">
                <X className="h-5 w-5 text-muted" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Title *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="Event title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Start Date *</label>
                  <input
                    type="date"
                    value={form.eventDate}
                    onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    min={form.eventDate || undefined}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                  {!form.endDate && <p className="text-xs text-muted mt-1">Leave blank for a single day.</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Start Time</label>
                  <input
                    type="time"
                    value={form.eventTime}
                    onChange={e => setForm(f => ({ ...f, eventTime: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">End Time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                    min={!form.endDate && form.eventTime ? form.eventTime : undefined}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                  {!form.eventTime && <p className="text-xs text-muted mt-1">Set start time first.</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">Category *</label>
                <select
                  value={form.category}
                  onChange={e => {
                    const cat = e.target.value as CalendarCategory;
                    setForm(f => ({
                      ...f,
                      category: cat,
                      // Auto-default personal category to personal visibility
                      visibility: cat === 'personal' && !editingEvent ? 'personal' : f.visibility,
                    }));
                  }}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  {CATEGORY_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as CalendarPriority }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Visibility</label>
                <div className="flex rounded-lg border border-line overflow-hidden text-sm">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, visibility: 'shared' }))}
                    className={`flex-1 px-3 py-2 text-center transition-colors ${
                      form.visibility === 'shared' ? 'bg-primary text-white' : 'text-muted hover:bg-canvas'
                    }`}
                  >👥 Shared</button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, visibility: 'personal' }))}
                    className={`flex-1 px-3 py-2 text-center transition-colors ${
                      form.visibility === 'personal' ? 'bg-primary text-white' : 'text-muted hover:bg-canvas'
                    }`}
                  >🔒 Personal</button>
                </div>
                <p className="text-xs text-muted mt-1">
                  {form.visibility === 'personal'
                    ? 'Only you can see this event.'
                    : 'All team members can see this event.'}
                </p>
              </div>

              {/* Multi-property assignment */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Assign to Properties</label>
                <div className="border border-line rounded-lg p-2 space-y-1 max-h-[160px] overflow-y-auto bg-surface">
                  <button
                    type="button"
                    onClick={() => {
                      if (form.propertyIds.size === properties.length) {
                        setForm(f => ({ ...f, propertyIds: new Set(), unitId: '' }));
                      } else {
                        setForm(f => ({ ...f, propertyIds: new Set(properties.map(p => p.id)), unitId: '' }));
                      }
                    }}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-canvas rounded flex items-center gap-2"
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                      form.propertyIds.size === properties.length ? 'bg-primary border-primary text-white' : 'border-line'
                    }`}>
                      {form.propertyIds.size === properties.length && <Check className="h-3 w-3" />}
                    </span>
                    <span className="font-medium">Select All Properties</span>
                  </button>
                  <div className="border-t border-line my-1" />
                  {properties.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setForm(f => {
                          const next = new Set(f.propertyIds);
                          if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                          return { ...f, propertyIds: next, unitId: next.size === 1 ? f.unitId : '' };
                        });
                      }}
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-canvas rounded flex items-center gap-2"
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                        form.propertyIds.has(p.id) ? 'bg-primary border-primary text-white' : 'border-line'
                      }`}>
                        {form.propertyIds.has(p.id) && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{p.name || p.address}</span>
                    </button>
                  ))}
                </div>
                {form.propertyIds.size === 0 && (
                  <p className="text-xs text-muted mt-1">No property selected. Event applies to all.</p>
                )}
              </div>

              {propertyUnits.length > 0 && form.propertyIds.size === 1 && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Unit</label>
                  <select
                    value={form.unitId}
                    onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    <option value="">All units</option>
                    {propertyUnits.map(u => <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={form.isRecurring}
                    onChange={e => setForm(f => ({ ...f, isRecurring: e.target.checked }))}
                    className="rounded border-line"
                  />
                  Recurring Event
                </label>
                {form.isRecurring && (
                  <select
                    value={form.recurrenceRule}
                    onChange={e => setForm(f => ({ ...f, recurrenceRule: e.target.value as RecurrenceRule }))}
                    className="mt-2 w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    <option value="">Select frequency</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="semi_annually">Semi Annually</option>
                    <option value="annually">Annually</option>
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  <span className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" /> Email Reminder</span>
                </label>
                <select
                  value={form.reminderHours}
                  onChange={e => setForm(f => ({ ...f, reminderHours: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  <option value="">No reminder</option>
                  <option value="24">24 hours before</option>
                  <option value="48">48 hours before</option>
                  <option value="168">1 week before</option>
                  <option value="336">2 weeks before</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  rows={2}
                  placeholder="Optional details"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/25"
                  rows={2}
                  placeholder="Internal notes"
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-5 border-t border-line shrink-0">
              <div className="flex items-center gap-3">
                {editingEvent && (
                  <button
                    onClick={() => { handleDelete(editingEvent.id); setShowModal(false); }}
                    className="text-sm text-danger hover:underline"
                  >Delete</button>
                )}
                {editingEvent && (
                  <button
                    onClick={() => { openDuplicate(editingEvent as ExpandedEvent); }}
                    className="text-sm text-muted hover:text-ink flex items-center gap-1"
                  ><Copy className="h-3.5 w-3.5" /> Duplicate</button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-muted hover:text-ink transition-colors"
                >Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.title.trim() || !form.eventDate}
                  className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50 transition-colors"
                >{saving ? 'Saving...' : editingEvent ? 'Update' : 'Create'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
