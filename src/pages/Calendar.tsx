import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight, List, Grid3X3,
  Check, Trash2, Edit2, X, AlertCircle, Bell,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useApp } from '../context/AppContext';
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
    ],
  },
  {
    label: 'Lease Management',
    items: [
      { value: 'lease_expiration', label: 'Lease Expiration' },
      { value: 'lease_renewal', label: 'Lease Renewal' },
      { value: 'move_in', label: 'Move In' },
      { value: 'move_out', label: 'Move Out' },
    ],
  },
  {
    label: 'Administrative',
    items: [
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
  move_in: 'bg-emerald-100 text-emerald-800',
  move_out: 'bg-pink-100 text-pink-800',
  contractor: 'bg-fuchsia-100 text-fuchsia-800',
  vendor: 'bg-purple-100 text-purple-800',
  licensing: 'bg-gray-100 text-gray-800',
  city_inspection: 'bg-amber-100 text-amber-800',
  custom: 'bg-stone-100 text-stone-800',
};

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
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'semi_annually':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'annually':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

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

const EMPTY_FORM = {
  title: '', description: '', category: 'custom' as CalendarCategory,
  eventDate: '', priority: 'medium' as CalendarPriority,
  isRecurring: false, recurrenceRule: '' as RecurrenceRule | '',
  propertyId: '', unitId: '', notes: '',
  reminderHours: '' as string,
};

export function Calendar() {
  const { properties, units } = useApp();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'calendar' | 'agenda'>('calendar');
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<CalendarCategory | ''>('');
  const [filterProperties, setFilterProperties] = useState<Set<string>>(new Set());
  const [showPropertyFilter, setShowPropertyFilter] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const data = await calendarApi.list();
      setEvents(data);
    } catch { /* silently fail */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (filterCategory) result = result.filter(e => e.category === filterCategory);
    if (filterProperties.size > 0) {
      result = result.filter(e => !e.propertyId || filterProperties.has(e.propertyId));
    }
    return result;
  }, [events, filterCategory, filterProperties]);

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
    expandedCalendarEvents.filter(e => e.eventDate === dateStr),
  [expandedCalendarEvents]);

  const today = todayLocalDate();

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
      .filter(e => !e.completed && !e.isRecurring && e.eventDate < today)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
  [filteredEvents, today]);

  const propertyUnits = useMemo(() =>
    form.propertyId ? units.filter(u => u.propertyId === form.propertyId) : [],
  [units, form.propertyId]);

  const openNew = (date?: string) => {
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, eventDate: date || todayLocalDate() });
    setShowModal(true);
  };

  const openEdit = (event: ExpandedEvent) => {
    const source = event.isVirtual
      ? events.find(e => e.id === event.sourceEventId) || event
      : event;
    setEditingEvent(source);
    setForm({
      title: source.title,
      description: source.description || '',
      category: source.category,
      eventDate: source.eventDate,
      priority: source.priority,
      isRecurring: source.isRecurring,
      recurrenceRule: source.recurrenceRule || '',
      propertyId: source.propertyId || '',
      unitId: source.unitId || '',
      notes: source.notes || '',
      reminderHours: source.reminderHours != null ? String(source.reminderHours) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.eventDate) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        recurrenceRule: form.isRecurring && form.recurrenceRule ? form.recurrenceRule : undefined,
        propertyId: form.propertyId || undefined,
        unitId: form.unitId || undefined,
        description: form.description || undefined,
        notes: form.notes || undefined,
        reminderHours: form.reminderHours ? Number(form.reminderHours) : undefined,
      };
      if (editingEvent) {
        await calendarApi.update(editingEvent.id, payload);
      } else {
        await calendarApi.create(payload);
      }
      setShowModal(false);
      await loadEvents();
    } catch { /* */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await calendarApi.delete(id);
      await loadEvents();
    } catch { /* */ }
  };

  const handleToggleComplete = async (event: ExpandedEvent) => {
    if (event.isVirtual) return;
    try {
      await calendarApi.update(event.id, { ...event, completed: !event.completed });
      await loadEvents();
    } catch { /* */ }
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
  };

  const togglePropertyFilter = (id: string) => {
    setFilterProperties(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllProperties = () => {
    if (filterProperties.size === properties.length) {
      setFilterProperties(new Set());
    } else {
      setFilterProperties(new Set(properties.map(p => p.id)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Calendar</h1>
          <p className="text-muted mt-1 text-sm">
            Property management events, deadlines, and reminders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line overflow-hidden text-xs">
            <button
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${view === 'calendar' ? 'bg-primary text-white' : 'text-muted hover:bg-canvas'}`}
              onClick={() => setView('calendar')}
            ><Grid3X3 className="h-3.5 w-3.5" /> Calendar</button>
            <button
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${view === 'agenda' ? 'bg-primary text-white' : 'text-muted hover:bg-canvas'}`}
              onClick={() => setView('agenda')}
            ><List className="h-3.5 w-3.5" /> Agenda</button>
          </div>
          <button
            onClick={() => openNew()}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> New Event
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-start">
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

        {/* Multi-property filter */}
        <div className="relative">
          <button
            onClick={() => setShowPropertyFilter(!showPropertyFilter)}
            className="text-sm border border-line rounded-lg px-3 py-1.5 bg-surface text-ink flex items-center gap-2 min-w-[160px]"
          >
            <span className="truncate">
              {filterProperties.size === 0
                ? 'All Properties'
                : filterProperties.size === properties.length
                  ? 'All Properties'
                  : `${filterProperties.size} ${filterProperties.size === 1 ? 'Property' : 'Properties'}`}
            </span>
            <ChevronLeft className={`h-3.5 w-3.5 transition-transform flex-shrink-0 ${showPropertyFilter ? 'rotate-90' : '-rotate-90'}`} />
          </button>
          {showPropertyFilter && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-surface border border-line rounded-lg shadow-lg py-1 min-w-[220px]">
              <button
                onClick={toggleAllProperties}
                className="w-full text-left px-3 py-2 text-sm hover:bg-canvas flex items-center gap-2"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                  filterProperties.size === 0 || filterProperties.size === properties.length ? 'bg-primary border-primary text-white' : 'border-line'
                }`}>
                  {(filterProperties.size === 0 || filterProperties.size === properties.length) && <Check className="h-3 w-3" />}
                </span>
                All Properties
              </button>
              <div className="border-t border-line my-1" />
              {properties.map(p => (
                <button
                  key={p.id}
                  onClick={() => togglePropertyFilter(p.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-canvas flex items-center gap-2"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                    filterProperties.has(p.id) ? 'bg-primary border-primary text-white' : 'border-line'
                  }`}>
                    {filterProperties.has(p.id) && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{p.name || p.address}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Overdue Banner */}
      {overdueEvents.length > 0 && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-5 w-5 text-danger" />
            <span className="font-semibold text-ink">
              {overdueEvents.length} overdue {overdueEvents.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          <div className="space-y-1.5">
            {overdueEvents.slice(0, 5).map(e => (
              <button
                key={e.id}
                onClick={() => openEdit(e)}
                className="w-full flex items-center gap-3 text-left text-sm hover:opacity-80"
              >
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[e.category] || 'bg-gray-100 text-gray-800'}`}>
                  {categoryLabel(e.category)}
                </span>
                <span className="text-ink flex-1 truncate">{e.title}</span>
                <span className="text-xs text-danger font-medium">{formatDate(e.eventDate)}</span>
              </button>
            ))}
            {overdueEvents.length > 5 && (
              <p className="text-xs text-muted">and {overdueEvents.length - 5} more</p>
            )}
          </div>
        </div>
      )}

      {view === 'calendar' ? (
        /* Calendar Grid */
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
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-line">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="py-2 text-center text-xs font-medium text-muted uppercase tracking-wide">{d}</div>
              ))}
            </div>
            {/* Day cells */}
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
                            onClick={ev => { ev.stopPropagation(); openEdit(e); }}
                            className={`w-full text-left text-[10px] sm:text-xs px-1.5 py-0.5 rounded truncate block ${
                              e.completed ? 'line-through opacity-50' : ''
                            } ${CATEGORY_COLORS[e.category] || 'bg-gray-100 text-gray-800'}`}
                          >
                            {e.title}
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
              <p className="text-center text-sm text-muted py-12">No upcoming events. Click "New Event" to create one.</p>
            ) : (
              <div className="border-t border-line divide-y divide-line">
                {upcomingEvents.map(event => {
                  const days = daysFromNow(event.eventDate);
                  const property = event.propertyId ? properties.find(p => p.id === event.propertyId) : null;
                  const pb = PRIORITY_BADGE[event.priority];
                  const expanded = event as ExpandedEvent;
                  return (
                    <div key={event.id} className="flex items-center gap-3 px-4 py-3.5 hover:bg-canvas/60">
                      <button
                        onClick={() => handleToggleComplete(expanded)}
                        disabled={expanded.isVirtual}
                        className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                          event.completed
                            ? 'bg-primary border-primary text-white'
                            : expanded.isVirtual
                              ? 'border-line/50 cursor-not-allowed'
                              : 'border-line hover:border-primary'
                        }`}
                      >
                        {event.completed && <Check className="h-3 w-3" />}
                      </button>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(expanded)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${event.completed ? 'line-through text-muted' : 'text-ink'}`}>
                            {event.title}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[event.category] || 'bg-gray-100'}`}>
                            {categoryLabel(event.category)}
                          </span>
                          {event.priority !== 'medium' && (
                            <Badge variant={pb.variant}>{pb.label}</Badge>
                          )}
                          {event.isRecurring && (
                            <span className="text-[10px] text-muted bg-canvas rounded px-1.5 py-0.5">
                              {event.recurrenceRule ? RECURRENCE_LABELS[event.recurrenceRule] : 'Recurring'}
                            </span>
                          )}
                          {event.reminderHours != null && (
                            <Bell className="h-3 w-3 text-muted" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                          <span>{formatDate(event.eventDate)}</span>
                          {days === 0 && <span className="text-primary font-medium">Today</span>}
                          {days === 1 && <span className="text-primary font-medium">Tomorrow</span>}
                          {days > 1 && days <= 7 && <span className="text-warning font-medium">In {days} days</span>}
                          {property && <span>· {property.name || property.address}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => openEdit(expanded)}
                          className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"
                        ><Edit2 className="h-3.5 w-3.5" /></button>
                        {!expanded.isVirtual && (
                          <button
                            onClick={() => handleDelete(event.id)}
                            className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger-soft transition-colors"
                          ><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Event Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-line">
              <h2 className="text-lg font-semibold text-ink">
                {editingEvent ? 'Edit Event' : 'New Event'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-canvas">
                <X className="h-5 w-5 text-muted" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Title *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  placeholder="Event title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Date *</label>
                  <input
                    type="date"
                    value={form.eventDate}
                    onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Category *</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value as CalendarCategory }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  >
                    {CATEGORY_GROUPS.map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value as CalendarPriority }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Property</label>
                  <select
                    value={form.propertyId}
                    onChange={e => setForm(f => ({ ...f, propertyId: e.target.value, unitId: '' }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  >
                    <option value="">All / None</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.name || p.address}</option>)}
                  </select>
                </div>
              </div>

              {propertyUnits.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Unit</label>
                  <select
                    value={form.unitId}
                    onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
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
                    className="mt-2 w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
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
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
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
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  rows={2}
                  placeholder="Optional details"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink"
                  rows={2}
                  placeholder="Internal notes"
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-5 border-t border-line">
              <div>
                {editingEvent && (
                  <button
                    onClick={() => { handleDelete(editingEvent.id); setShowModal(false); }}
                    className="text-sm text-danger hover:underline"
                  >Delete</button>
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
