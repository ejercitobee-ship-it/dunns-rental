import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Search, ListChecks, Clock, AlertTriangle, CheckCircle2,
  Calendar, User, Building2, MessageSquare, ChevronRight,
  Filter, FolderKanban, Loader2, X, Send, Pause, Circle,
  LayoutList, Columns3, GripVertical,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatDate, todayLocalDate } from '../lib/utils';
import { tasksApi, projectsApi } from '../lib/api';
import type { TaskStats, TaskFilters, TaskDetail } from '../lib/api';
import type {
  Task, TaskStatus, TaskPriority, TaskCategory,
  TaskActivityEntry, Project,
} from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'leasing', label: 'Leasing' },
  { value: 'finance', label: 'Finance' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'management', label: 'Management' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'technology', label: 'Technology' },
  { value: 'projects', label: 'Projects' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: 'text-danger',
  high: 'text-warning',
  medium: 'text-muted',
  low: 'text-faint',
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: 'bg-danger',
  high: 'bg-warning',
  medium: 'bg-line-strong',
  low: 'bg-line',
};

const STATUS_BADGE: Record<TaskStatus, 'secondary' | 'default' | 'warning' | 'success' | 'destructive'> = {
  todo: 'secondary',
  in_progress: 'default',
  waiting: 'warning',
  completed: 'success',
  cancelled: 'destructive',
};

type ViewMode = 'my' | 'all' | 'today' | 'overdue' | 'completed' | 'projects';

const emptyForm = {
  title: '',
  description: '',
  category: 'other' as TaskCategory,
  status: 'todo' as TaskStatus,
  priority: 'medium' as TaskPriority,
  assignedTo: '',
  dueDate: '',
  propertyId: '',
  unitId: '',
  tenantId: '',
  vendorId: '',
  projectId: '',
  waitingFor: '',
  estimatedMinutes: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Tasks() {
  const { properties, units } = useApp();
  const { hasPermission } = useAuth();
  const { showToast } = useToast();

  const canCreate = hasPermission('tasks_create');
  const canEdit = hasPermission('tasks_edit');
  const canDelete = hasPermission('tasks_delete');
  const canAssign = hasPermission('tasks_assign');
  const canManageProjects = hasPermission('projects_manage');

  // Data
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string }[]>([]);

  // View & filters
  const [view, setView] = useState<ViewMode>('my');
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  // Project form
  const [projectForm, setProjectForm] = useState({
    name: '', description: '', status: 'active', priority: 'medium',
    dueDate: '', propertyId: '',
  });

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  const loadTasks = useCallback(async () => {
    try {
      const filters: TaskFilters = {};
      if (view === 'my') filters.view = 'my';
      if (view === 'today') filters.due = 'today';
      if (view === 'overdue') filters.due = 'overdue';
      if (view === 'completed') filters.status = 'completed';
      if (view === 'all' || view === 'my' || view === 'today' || view === 'overdue') {
        if (statusFilter) filters.status = statusFilter;
        if (priorityFilter) filters.priority = priorityFilter;
        if (categoryFilter) filters.category = categoryFilter;
      }
      if (search) filters.search = search;
      const data = await tasksApi.list(filters);
      setTasks(data);
    } catch {
      showToast('Failed to load tasks', 'error');
    }
  }, [view, search, statusFilter, priorityFilter, categoryFilter, showToast]);

  const loadStats = useCallback(async () => {
    try {
      const data = await tasksApi.stats();
      setStats(data);
    } catch { /* ignore */ }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const data = await projectsApi.list();
      setProjects(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadTasks(), loadStats(), loadProjects()])
      .finally(() => setLoading(false));
  }, [loadTasks, loadStats, loadProjects]);

  const INTERNAL_ROLES = useMemo(() => new Set(['super_admin', 'admin', 'manager', 'accountant', 'viewer']), []);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (res.ok) {
          const json = await res.json() as {
            data?: { id: string; firstName: string; lastName: string; roleId: string; isActive: boolean }[];
          };
          setTeamMembers(
            (json.data || [])
              .filter(u => u.isActive && INTERNAL_ROLES.has(u.roleId))
              .map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }))
          );
        }
      } catch { /* ignore */ }
    })();
  }, [INTERNAL_ROLES]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleCreate = async () => {
    if (!form.title.trim()) { showToast('Title is required', 'error'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description || undefined,
        category: form.category,
        status: form.status,
        priority: form.priority,
        assignedTo: form.assignedTo || undefined,
        dueDate: form.dueDate || undefined,
        propertyId: form.propertyId || undefined,
        unitId: form.unitId || undefined,
        tenantId: form.tenantId || undefined,
        vendorId: form.vendorId || undefined,
        projectId: form.projectId || undefined,
        waitingFor: form.waitingFor || undefined,
        estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : undefined,
      };

      if (editingId) {
        await tasksApi.update(editingId, payload as Partial<Task>);
        showToast('Task updated', 'success');
      } else {
        await tasksApi.create(payload as Partial<Task>);
        showToast('Task created', 'success');
      }
      setIsCreateOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      loadTasks();
      loadStats();
    } catch {
      showToast('Failed to save task', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (task: Task, newStatus: TaskStatus) => {
    try {
      await tasksApi.update(task.id, { status: newStatus } as Partial<Task>);
      loadTasks();
      loadStats();
      if (detailTask && detailTask.task.id === task.id) {
        openDetail(task.id);
      }
    } catch {
      showToast('Failed to update status', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task permanently?')) return;
    try {
      await tasksApi.delete(id);
      showToast('Task deleted', 'success');
      setDetailTask(null);
      loadTasks();
      loadStats();
    } catch {
      showToast('Failed to delete task', 'error');
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await tasksApi.get(id);
      setDetailTask(data);
    } catch {
      showToast('Failed to load task details', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleComment = async () => {
    if (!detailTask || !commentText.trim()) return;
    try {
      await tasksApi.addComment(detailTask.task.id, commentText);
      setCommentText('');
      openDetail(detailTask.task.id);
    } catch {
      showToast('Failed to add comment', 'error');
    }
  };

  const openEdit = (task: Task) => {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description || '',
      category: task.category,
      status: task.status,
      priority: task.priority,
      assignedTo: task.assignedTo || '',
      dueDate: task.dueDate || '',
      propertyId: task.propertyId || '',
      unitId: task.unitId || '',
      tenantId: task.tenantId || '',
      vendorId: task.vendorId || '',
      projectId: task.projectId || '',
      waitingFor: task.waitingFor || '',
      estimatedMinutes: task.estimatedMinutes?.toString() || '',
    });
    setIsCreateOpen(true);
  };

  const handleCreateProject = async () => {
    if (!projectForm.name.trim()) { showToast('Project name is required', 'error'); return; }
    setSaving(true);
    try {
      await projectsApi.create({
        name: projectForm.name,
        description: projectForm.description || undefined,
        status: projectForm.status,
        priority: projectForm.priority as TaskPriority,
        dueDate: projectForm.dueDate || undefined,
        propertyId: projectForm.propertyId || undefined,
      } as Partial<Project>);
      showToast('Project created', 'success');
      setIsProjectModalOpen(false);
      setProjectForm({ name: '', description: '', status: 'active', priority: 'medium', dueDate: '', propertyId: '' });
      loadProjects();
      loadStats();
    } catch {
      showToast('Failed to create project', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Filtered units for selected property
  const filteredUnits = useMemo(() => {
    if (!form.propertyId) return [];
    return units.filter(u => u.propertyId === form.propertyId);
  }, [form.propertyId, units]);

  const today = todayLocalDate();

  const activeFilters = [statusFilter, priorityFilter, categoryFilter].filter(Boolean).length;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Tasks</h1>
        </div>
        <div className="flex items-center gap-2">
          {canManageProjects && (
            <Button variant="outline" onClick={() => setIsProjectModalOpen(true)}>
              <FolderKanban className="w-4 h-4 mr-1.5" />
              New Project
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => { setEditingId(null); setForm(emptyForm); setIsCreateOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" />
              New Task
            </Button>
          )}
        </div>
      </div>

      {/* Stat Cards (Dashboard-style) */}
      {stats && (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-5">
          <TaskStatCard
            title="My open" value={stats.myOpen}
            icon={<User />}
            onClick={() => setView('my')} active={view === 'my'}
          />
          <TaskStatCard
            title="Overdue" value={stats.overdue}
            icon={<AlertTriangle />}
            iconBg="bg-danger-soft text-danger"
            valueColor={stats.overdue > 0 ? 'text-danger' : undefined}
            onClick={() => setView('overdue')} active={view === 'overdue'}
          />
          <TaskStatCard
            title="Due today" value={stats.dueToday}
            icon={<Clock />}
            iconBg="bg-warning-soft text-warning"
            valueColor={stats.dueToday > 0 ? 'text-warning' : undefined}
            onClick={() => setView('today')} active={view === 'today'}
          />
          <TaskStatCard
            title="All open" value={stats.open}
            icon={<ListChecks />}
            onClick={() => setView('all')} active={view === 'all'}
          />
          <TaskStatCard
            title="Projects" value={stats.activeProjects}
            icon={<FolderKanban />}
            onClick={() => setView('projects')} active={view === 'projects'}
          />
        </div>
      )}

      {/* Search + View Tabs + Filter toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-line bg-surface text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-line transition-colors"
            />
          </div>

          {/* View tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-line">
            <TabButton label="My Tasks" active={view === 'my'} onClick={() => setView('my')} />
            <TabButton label="All" active={view === 'all'} onClick={() => setView('all')} />
            <TabButton label="Completed" active={view === 'completed'} onClick={() => setView('completed')} />
            <TabButton label="Projects" active={view === 'projects'} onClick={() => setView('projects')} />
          </div>

          {/* Layout toggle */}
          {view !== 'projects' && (
            <div className="flex items-center p-1 rounded-xl bg-surface border border-line">
              <button
                onClick={() => setLayout('list')}
                className={`p-1.5 rounded-lg transition-all ${layout === 'list' ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-ink'}`}
                title="List view"
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button
                onClick={() => setLayout('board')}
                className={`p-1.5 rounded-lg transition-all ${layout === 'board' ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-ink'}`}
                title="Board view"
              >
                <Columns3 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all ${
              showFilters || activeFilters > 0
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-line bg-surface text-muted hover:border-line-strong'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilters > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold grid place-items-center">{activeFilters}</span>
            )}
          </button>
        </div>

        {/* Filter row */}
        {showFilters && view !== 'projects' && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-line bg-surface">
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}
              options={STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
            <FilterSelect label="Priority" value={priorityFilter} onChange={setPriorityFilter}
              options={PRIORITY_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
            <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}
              options={CATEGORY_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
            {activeFilters > 0 && (
              <button
                onClick={() => { setStatusFilter(''); setPriorityFilter(''); setCategoryFilter(''); }}
                className="ml-auto text-xs text-muted hover:text-danger flex items-center gap-1 transition-colors"
              >
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content area */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading tasks...</span>
        </div>
      ) : view === 'projects' ? (
        <ProjectsList projects={projects} />
      ) : tasks.length === 0 ? (
        <EmptyState view={view} />
      ) : layout === 'board' ? (
        <KanbanBoard
          tasks={tasks}
          today={today}
          onStatusChange={canEdit ? handleStatusChange : undefined}
          onCardClick={id => openDetail(id)}
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[auto_1fr_120px_100px_90px_100px] sm:grid-cols-[auto_1fr_120px_100px_90px_100px] gap-x-3 px-4 py-2.5 border-b border-line bg-canvas">
            <div className="w-6" />
            <span className="eyebrow !text-[10px]">Task</span>
            <span className="eyebrow !text-[10px] hidden sm:block">Assignee</span>
            <span className="eyebrow !text-[10px] hidden sm:block">Due date</span>
            <span className="eyebrow !text-[10px] hidden sm:block">Priority</span>
            <span className="eyebrow !text-[10px] hidden sm:block">Category</span>
          </div>

          {/* Task rows */}
          <div className="divide-y divide-line">
            {tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onStatusChange={canEdit ? handleStatusChange : undefined}
                onClick={() => openDetail(task.id)}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Task Detail Drawer */}
      {(detailTask || detailLoading) && (
        <TaskDetailDrawer
          detail={detailTask}
          loading={detailLoading}
          onClose={() => { setDetailTask(null); setCommentText(''); }}
          onStatusChange={canEdit ? handleStatusChange : undefined}
          onEdit={canEdit ? openEdit : undefined}
          onDelete={canDelete ? handleDelete : undefined}
          commentText={commentText}
          setCommentText={setCommentText}
          onComment={handleComment}
        />
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setEditingId(null); }}
        title={editingId ? 'Edit Task' : 'New Task'}
      >
        <div className="space-y-4">
          <FormField label="Title" required>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="form-input"
              placeholder="What needs to be done?"
              autoFocus
            />
          </FormField>

          <FormField label="Description">
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="form-input min-h-[72px] resize-y"
              rows={3}
              placeholder="Add details..."
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Category">
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as TaskCategory }))} className="form-input">
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FormField>
            <FormField label="Priority">
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))} className="form-input">
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status">
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as TaskStatus }))} className="form-input">
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FormField>
            <FormField label="Due Date">
              <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="form-input" />
            </FormField>
          </div>

          {canAssign && (
            <FormField label="Assign To">
              <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} className="form-input">
                <option value="">Unassigned</option>
                {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </FormField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Property">
              <select value={form.propertyId} onChange={e => setForm(f => ({ ...f, propertyId: e.target.value, unitId: '' }))} className="form-input">
                <option value="">None</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Unit">
              <select value={form.unitId} onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))} className="form-input" disabled={!form.propertyId}>
                <option value="">None</option>
                {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
              </select>
            </FormField>
          </div>

          {projects.length > 0 && (
            <FormField label="Project">
              <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} className="form-input">
                <option value="">None</option>
                {projects.filter(p => p.status !== 'completed' && p.status !== 'cancelled').map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
          )}

          {form.status === 'waiting' && (
            <FormField label="Waiting For">
              <input
                type="text"
                value={form.waitingFor}
                onChange={e => setForm(f => ({ ...f, waitingFor: e.target.value }))}
                className="form-input"
                placeholder="e.g. Tenant response, vendor quote..."
              />
            </FormField>
          )}

          <FormField label="Estimated Time (minutes)">
            <input
              type="number"
              value={form.estimatedMinutes}
              onChange={e => setForm(f => ({ ...f, estimatedMinutes: e.target.value }))}
              className="form-input"
              placeholder="Optional"
              min={0}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditingId(null); }}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              {editingId ? 'Update' : 'Create'} Task
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Project Modal */}
      <Modal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        title="New Project"
      >
        <div className="space-y-4">
          <FormField label="Name" required>
            <input type="text" value={projectForm.name} onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))}
              className="form-input" placeholder="Project name" autoFocus />
          </FormField>
          <FormField label="Description">
            <textarea value={projectForm.description} onChange={e => setProjectForm(f => ({ ...f, description: e.target.value }))}
              className="form-input min-h-[56px] resize-y" rows={2} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priority">
              <select value={projectForm.priority} onChange={e => setProjectForm(f => ({ ...f, priority: e.target.value }))} className="form-input">
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FormField>
            <FormField label="Due Date">
              <input type="date" value={projectForm.dueDate} onChange={e => setProjectForm(f => ({ ...f, dueDate: e.target.value }))}
                className="form-input" />
            </FormField>
          </div>
          <FormField label="Property">
            <select value={projectForm.propertyId} onChange={e => setProjectForm(f => ({ ...f, propertyId: e.target.value }))} className="form-input">
              <option value="">None</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Button variant="outline" onClick={() => setIsProjectModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateProject} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              Create Project
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TaskStatCard({ title, value, icon, iconBg = 'bg-primary-soft text-primary', valueColor, onClick, active }: {
  title: string; value: number; icon: React.ReactNode;
  iconBg?: string; valueColor?: string;
  onClick: () => void; active: boolean;
}) {
  return (
    <Card
      className={`cursor-pointer transition-all ${
        active
          ? 'border-primary ring-1 ring-primary/20 shadow-[0_2px_12px_rgba(36,80,63,0.12)]'
          : 'hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.07)]'
      }`}
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="eyebrow">{title}</span>
          <span className={`w-[34px] h-[34px] rounded-[10px] grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px] ${iconBg}`}>{icon}</span>
        </div>
        <div className="mt-3">
          <span className={`font-display text-[24px] leading-none font-medium tnum ${valueColor || 'text-ink'}`}>{value}</span>
        </div>
      </div>
    </Card>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[13px] rounded-lg whitespace-nowrap transition-all ${
        active
          ? 'bg-primary text-white font-medium shadow-sm'
          : 'text-muted hover:text-ink hover:bg-hover'
      }`}
    >
      {label}
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-faint uppercase tracking-wider">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 text-xs border border-line rounded-lg bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-primary/20"
      >
        <option value="">All</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function TaskRow({ task, today, onStatusChange, onClick }: {
  task: Task; today: string;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onClick: () => void;
}) {
  const isOverdue = task.dueDate && task.dueDate < today && task.status !== 'completed' && task.status !== 'cancelled';
  const isCompleted = task.status === 'completed';

  return (
    <div
      className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_120px_100px_90px_100px] gap-x-3 items-center px-4 py-3 cursor-pointer hover:bg-hover/50 transition-colors group"
      onClick={onClick}
    >
      {/* Checkbox */}
      <button
        onClick={e => { e.stopPropagation(); onStatusChange?.(task, isCompleted ? 'todo' : 'completed'); }}
        className="w-6 h-6 flex items-center justify-center flex-shrink-0"
        disabled={!onStatusChange}
      >
        {isCompleted ? (
          <CheckCircle2 className="w-[18px] h-[18px] text-positive" />
        ) : (
          <Circle className="w-[18px] h-[18px] text-line-strong group-hover:text-primary transition-colors" />
        )}
      </button>

      {/* Title + metadata (mobile: everything here) */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${isCompleted ? 'line-through text-faint' : 'text-ink'}`}>
            {task.title}
          </span>
          {task.status === 'waiting' && (
            <Badge variant="warning" className="!py-0 !text-[10px]">
              <Pause className="w-2.5 h-2.5 mr-0.5" />
              Waiting
            </Badge>
          )}
          {task.status === 'in_progress' && (
            <Badge variant="default" className="!py-0 !text-[10px]">In Progress</Badge>
          )}
        </div>
        {/* Mobile-only metadata row */}
        <div className="flex items-center gap-3 mt-0.5 sm:hidden text-[11px] text-muted">
          {task.assignedToName && <span>{task.assignedToName}</span>}
          {task.dueDate && (
            <span className={isOverdue ? 'text-danger font-medium' : ''}>
              {safeDateLabel(task.dueDate)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`} />
            {task.priority}
          </span>
        </div>
        {/* Property/project sub-line */}
        {(task.propertyName || task.projectName) && (
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-faint">
            {task.propertyName && (
              <span className="flex items-center gap-0.5">
                <Building2 className="w-3 h-3" />
                {task.propertyName}{task.unitNumber ? ` / ${task.unitNumber}` : ''}
              </span>
            )}
            {task.projectName && (
              <span className="flex items-center gap-0.5">
                <FolderKanban className="w-3 h-3" />
                {task.projectName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Assignee */}
      <div className="hidden sm:flex items-center gap-1.5 min-w-0">
        {task.assignedToName ? (
          <>
            <span className="w-6 h-6 rounded-full bg-primary-soft text-primary text-[10px] font-bold grid place-items-center flex-shrink-0">
              {initials(task.assignedToName)}
            </span>
            <span className="text-xs text-muted truncate">{task.assignedToName.split(' ')[0]}</span>
          </>
        ) : (
          <span className="text-xs text-faint">--</span>
        )}
      </div>

      {/* Due date */}
      <div className="hidden sm:block">
        {task.dueDate ? (
          <span className={`text-xs ${isOverdue ? 'text-danger font-medium' : 'text-muted'}`}>
            {safeDateLabel(task.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-faint">--</span>
        )}
      </div>

      {/* Priority */}
      <div className="hidden sm:flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[task.priority]}`} />
        <span className={`text-xs capitalize ${PRIORITY_COLOR[task.priority]}`}>{task.priority}</span>
      </div>

      {/* Category */}
      <div className="hidden sm:block">
        <span className="text-xs text-muted">
          {CATEGORY_OPTIONS.find(c => c.value === task.category)?.label}
        </span>
      </div>
    </div>
  );
}

function TaskDetailDrawer({ detail, loading, onClose, onStatusChange, onEdit, onDelete, commentText, setCommentText, onComment }: {
  detail: TaskDetail | null;
  loading: boolean;
  onClose: () => void;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (id: string) => void;
  commentText: string;
  setCommentText: (v: string) => void;
  onComment: () => void;
}) {
  const task = detail?.task;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-lg bg-surface border-l border-line overflow-y-auto animate-slide-in-right shadow-[-8px_0_24px_rgba(27,26,23,0.08)]"
        onClick={e => e.stopPropagation()}
      >
        {loading || !task ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-5 h-5 animate-spin text-muted" />
          </div>
        ) : (
          <>
            {/* Drawer header */}
            <div className="sticky top-0 bg-surface border-b border-line px-6 py-4 flex items-start justify-between z-10">
              <div className="flex-1 min-w-0 mr-3">
                <p className="eyebrow mb-1">
                  {CATEGORY_OPTIONS.find(c => c.value === task.category)?.label}
                </p>
                <h2 className="font-display text-xl font-medium text-ink leading-snug">{task.title}</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-hover text-muted transition-colors flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Status + priority bar */}
              <div className="flex items-center gap-3 flex-wrap">
                {onStatusChange && (
                  <select
                    value={task.status}
                    onChange={e => onStatusChange(task, e.target.value as TaskStatus)}
                    className="px-3 py-1.5 text-xs border border-line rounded-lg bg-surface text-ink font-medium focus:outline-none focus:ring-1 focus:ring-primary/20"
                  >
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                <Badge variant={STATUS_BADGE[task.status]}>
                  {STATUS_OPTIONS.find(s => s.value === task.status)?.label}
                </Badge>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[task.priority]}`} />
                  <span className={`text-xs font-medium capitalize ${PRIORITY_COLOR[task.priority]}`}>
                    {task.priority} priority
                  </span>
                </div>
              </div>

              {/* Description */}
              {task.description && (
                <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">{task.description}</p>
              )}

              {/* Detail fields */}
              <div className="rounded-xl border border-line divide-y divide-line overflow-hidden">
                {task.dueDate && (
                  <DetailField icon={Calendar} label="Due date" value={safeDateLabel(task.dueDate)} />
                )}
                {task.assignedToName && (
                  <DetailField icon={User} label="Assignee" value={task.assignedToName} />
                )}
                {task.propertyName && (
                  <DetailField icon={Building2} label="Property" value={`${task.propertyName}${task.unitNumber ? ` / ${task.unitNumber}` : ''}`} />
                )}
                {task.projectName && (
                  <DetailField icon={FolderKanban} label="Project" value={task.projectName} />
                )}
                {task.tenantName && (
                  <DetailField icon={User} label="Tenant" value={task.tenantName} />
                )}
                {task.vendorName && (
                  <DetailField icon={User} label="Vendor" value={task.vendorName} />
                )}
                {task.waitingFor && (
                  <DetailField icon={Pause} label="Waiting for" value={task.waitingFor} />
                )}
                {task.createdByName && (
                  <DetailField icon={User} label="Created by" value={task.createdByName} />
                )}
                {task.estimatedMinutes && (
                  <DetailField icon={Clock} label="Estimate" value={`${task.estimatedMinutes} min`} />
                )}
              </div>

              {/* Tags */}
              {detail.tags.length > 0 && (
                <div>
                  <p className="eyebrow mb-2">Tags</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {detail.tags.map(t => (
                      <Badge key={t.id} variant="outline">{t.name}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {onEdit && (
                  <Button variant="outline" size="sm" onClick={() => { onEdit(task); onClose(); }}>
                    Edit Task
                  </Button>
                )}
                {onDelete && (
                  <Button variant="destructive" size="sm" onClick={() => onDelete(task.id)}>
                    Delete
                  </Button>
                )}
              </div>

              {/* Comments */}
              <div>
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Comments ({detail.comments.length})
                </p>
                {detail.comments.length > 0 && (
                  <div className="space-y-3 max-h-56 overflow-y-auto mb-3">
                    {detail.comments.map(c => (
                      <div key={c.id} className="rounded-xl bg-canvas p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary-soft text-primary text-[10px] font-bold grid place-items-center">
                              {initials(c.userName || 'U')}
                            </span>
                            <span className="text-sm font-medium text-ink">{c.userName || 'Unknown'}</span>
                          </div>
                          <span className="text-[11px] text-faint">
                            {safeTimestamp(c.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-muted leading-relaxed ml-8 whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onComment(); } }}
                    className="flex-1 px-3 py-2 border border-line rounded-xl text-sm text-ink placeholder:text-faint bg-surface focus:outline-none focus:ring-1 focus:ring-primary/20"
                    placeholder="Add a comment..."
                  />
                  <Button size="sm" onClick={onComment} disabled={!commentText.trim()}>
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Activity */}
              {detail.activity.length > 0 && (
                <div>
                  <p className="eyebrow mb-3">Activity</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {detail.activity.map(a => (
                      <div key={a.id} className="flex items-start gap-2.5 text-xs text-muted">
                        <span className="w-1.5 h-1.5 rounded-full bg-line-strong mt-1.5 flex-shrink-0" />
                        <span className="leading-relaxed">
                          <strong className="text-ink font-medium">{a.userName || 'System'}</strong>{' '}
                          {formatActivity(a)}
                          <span className="ml-1.5 text-faint">{safeTimestamp(a.createdAt)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailField({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="w-4 h-4 text-faint flex-shrink-0" />
      <span className="text-xs text-muted w-24 flex-shrink-0">{label}</span>
      <span className="text-sm text-ink font-medium">{value}</span>
    </div>
  );
}

function ProjectsList({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <Card>
        <div className="py-16 text-center">
          <FolderKanban className="w-10 h-10 mx-auto mb-3 text-line-strong" />
          <p className="text-sm font-medium text-ink">No projects yet</p>
          <p className="text-xs text-muted mt-1">Create a project to group related tasks</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map(project => {
        const progress = project.taskCount ? Math.round(((project.completedCount || 0) / project.taskCount) * 100) : 0;
        return (
          <Card key={project.id} className="hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.07)] transition-all">
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="w-[34px] h-[34px] rounded-[10px] bg-primary-soft text-primary grid place-items-center flex-shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      <FolderKanban />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-base font-medium text-ink">{project.name}</span>
                        <Badge variant={
                          project.status === 'active' ? 'success' :
                          project.status === 'on_hold' ? 'warning' :
                          project.status === 'completed' ? 'default' : 'secondary'
                        }>
                          {project.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      {project.description && (
                        <p className="text-xs text-muted mt-0.5 line-clamp-1">{project.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                    {project.ownerName && (
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {project.ownerName}
                      </span>
                    )}
                    {project.dueDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {safeDateLabel(project.dueDate)}
                      </span>
                    )}
                    {project.propertyName && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {project.propertyName}
                      </span>
                    )}
                    <span className="tnum">{project.completedCount || 0}/{project.taskCount || 0} tasks</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-faint flex-shrink-0 mt-2" />
              </div>

              {(project.taskCount || 0) > 0 && (
                <div className="mt-4">
                  <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden">
                    <div
                      className="h-full bg-positive rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-faint mt-1 tnum">{progress}% complete</span>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban Board
// ---------------------------------------------------------------------------

const KANBAN_COLUMNS: { status: TaskStatus; label: string; accent: string; dotColor: string }[] = [
  { status: 'todo',        label: 'To Do',       accent: 'border-t-line-strong', dotColor: 'bg-line-strong' },
  { status: 'in_progress', label: 'In Progress', accent: 'border-t-primary',     dotColor: 'bg-primary' },
  { status: 'waiting',     label: 'Waiting',     accent: 'border-t-warning',     dotColor: 'bg-warning' },
  { status: 'completed',   label: 'Completed',   accent: 'border-t-positive',    dotColor: 'bg-positive' },
];

function KanbanBoard({ tasks, today, onStatusChange, onCardClick }: {
  tasks: Task[];
  today: string;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onCardClick: (id: string) => void;
}) {
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], waiting: [], completed: [], cancelled: [] };
    for (const t of tasks) (map[t.status] || map.todo).push(t);
    return map;
  }, [tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDragTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragOver = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(status);
  };

  const handleDragLeave = () => setDragOverCol(null);

  const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = e.dataTransfer.getData('text/plain') || dragTaskId;
    if (!taskId || !onStatusChange) return;
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== status) onStatusChange(task, status);
    setDragTaskId(null);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
      {KANBAN_COLUMNS.map(col => {
        const colTasks = grouped[col.status];
        return (
          <div
            key={col.status}
            className={`flex-1 min-w-[260px] max-w-[340px] flex flex-col rounded-2xl border border-t-[3px] ${col.accent} ${
              dragOverCol === col.status ? 'border-primary bg-primary-soft/30' : 'border-line bg-canvas'
            } transition-colors`}
            onDragOver={e => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, col.status)}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-4 py-3">
              <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
              <span className="text-xs font-semibold text-ink uppercase tracking-wider">{col.label}</span>
              <span className="ml-auto text-[11px] font-medium text-faint tnum">{colTasks.length}</span>
            </div>

            {/* Cards */}
            <div className="flex-1 px-2.5 pb-2.5 space-y-2 min-h-[80px]">
              {colTasks.map(task => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  today={today}
                  draggable={!!onStatusChange}
                  onDragStart={e => handleDragStart(e, task.id)}
                  onClick={() => onCardClick(task.id)}
                />
              ))}
              {colTasks.length === 0 && (
                <div className="flex items-center justify-center h-16 rounded-xl border border-dashed border-line text-xs text-faint">
                  No tasks
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ task, today, draggable, onDragStart, onClick }: {
  task: Task;
  today: string;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  const isOverdue = task.dueDate && task.dueDate < today && task.status !== 'completed' && task.status !== 'cancelled';

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className="group rounded-xl border border-line bg-surface p-3 cursor-pointer hover:border-line-strong hover:shadow-[0_2px_8px_rgba(27,26,23,0.06)] transition-all active:shadow-none"
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="w-3.5 h-3.5 text-line-strong mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${task.status === 'completed' ? 'line-through text-faint' : 'text-ink'}`}>
            {task.title}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`} />
              <span className={`text-[11px] capitalize ${PRIORITY_COLOR[task.priority]}`}>{task.priority}</span>
            </span>

            {task.dueDate && (
              <span className={`text-[11px] ${isOverdue ? 'text-danger font-medium' : 'text-muted'}`}>
                {safeDateLabel(task.dueDate)}
              </span>
            )}

            <span className="text-[11px] text-faint">
              {CATEGORY_OPTIONS.find(c => c.value === task.category)?.label}
            </span>
          </div>

          {/* Assignee + property */}
          <div className="flex items-center gap-2 mt-1.5">
            {task.assignedToName && (
              <div className="flex items-center gap-1">
                <span className="w-5 h-5 rounded-full bg-primary-soft text-primary text-[9px] font-bold grid place-items-center flex-shrink-0">
                  {initials(task.assignedToName)}
                </span>
                <span className="text-[11px] text-muted truncate max-w-[80px]">{task.assignedToName.split(' ')[0]}</span>
              </div>
            )}
            {task.propertyName && (
              <span className="flex items-center gap-0.5 text-[11px] text-faint truncate">
                <Building2 className="w-3 h-3 flex-shrink-0" />
                {task.propertyName}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ view }: { view: ViewMode }) {
  return (
    <Card>
      <div className="py-16 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-[14px] bg-primary-soft text-primary grid place-items-center">
          <ListChecks className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium text-ink">
          {view === 'my' ? 'No tasks assigned to you' :
           view === 'overdue' ? 'No overdue tasks' :
           view === 'today' ? 'Nothing due today' :
           view === 'completed' ? 'No completed tasks' :
           'No tasks found'}
        </p>
        <p className="text-xs text-muted mt-1">
          {view === 'my' ? 'Create a task or ask someone to assign one to you' :
           'Adjust your filters or create a new task'}
        </p>
      </div>
    </Card>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1.5">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

function safeDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return formatDate(dateStr);
  const [y, m, d] = parts;
  const year = Number(y);
  if (year > 2100 || year < 1970) return `${m}/${d}/${String(year).slice(0, 4)}`;
  return formatDate(dateStr);
}

function safeTimestamp(epoch: number): string {
  try {
    const d = new Date(epoch * 1000);
    const iso = d.toISOString().split('T')[0];
    return safeDateLabel(iso);
  } catch {
    return '';
  }
}

function formatActivity(a: TaskActivityEntry): string {
  switch (a.action) {
    case 'created': return 'created this task';
    case 'status_changed': return `changed status from ${a.fromValue} to ${a.toValue}`;
    case 'assigned': return `assigned to ${a.toValue || 'unassigned'}`;
    case 'priority_changed': return `changed priority from ${a.fromValue} to ${a.toValue}`;
    case 'due_date_changed': return `changed due date to ${a.toValue || 'none'}`;
    case 'category_changed': return `changed category from ${a.fromValue} to ${a.toValue}`;
    case 'comment_added': return 'added a comment';
    case 'completed': return 'marked as completed';
    default: return a.action.replace(/_/g, ' ');
  }
}
