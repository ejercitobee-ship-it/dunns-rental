import { useEffect, useState, useMemo } from 'react';
import { Shield, Search, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { adminApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { SYSTEM_PERMISSIONS, PERMISSION_MODULES, type Permission } from '../types/auth';
import type { User } from '../types/auth';

interface Props {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a grant/revoke so the parent can refresh. */
  onChanged?: () => void;
}

interface OverrideEntry {
  permission: string;
  grantedBy: string;
  grantedAt: number;
}

interface AuditEntry {
  id: string;
  action: string;
  permission?: string;
  oldRole?: string;
  newRole?: string;
  changedByName: string;
  createdAt: number;
}

export function UserPermissions({ user, isOpen, onClose, onChanged }: Props) {
  const { showToast } = useToast();
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showAudit, setShowAudit] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Load existing overrides + audit when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setSearch('');
    setShowAudit(false);
    Promise.all([
      adminApi.getUserPermissions(user.id).catch(() => []),
      adminApi.getPermissionAudit({ userId: user.id, limit: 50 }).catch(() => []),
    ]).then(([perms, log]) => {
      setOverrides(perms);
      setAudit(log);
    }).finally(() => setLoading(false));
  }, [isOpen, user.id]);

  // Which permissions come from the user's role
  const rolePerms = useMemo(() => new Set(user.role.permissions), [user.role]);
  // Which are per-user overrides
  const overrideSet = useMemo(() => new Set(overrides.map(o => o.permission)), [overrides]);

  // Group permissions by module, filtered by search
  const modules = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const perm of SYSTEM_PERMISSIONS) {
      const q = search.toLowerCase();
      if (q && !perm.name.toLowerCase().includes(q) && !perm.id.toLowerCase().includes(q) && !perm.description.toLowerCase().includes(q)) {
        continue;
      }
      if (!groups.has(perm.module)) groups.set(perm.module, []);
      groups.get(perm.module)!.push(perm);
    }
    return groups;
  }, [search]);

  const toggleModule = (mod: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  };

  const handleToggle = async (permId: string, currentlyGranted: boolean) => {
    if (rolePerms.has(permId) && !overrideSet.has(permId)) {
      // This perm comes from the role: can't revoke a role perm via overrides.
      showToast('This permission comes from the role. Change the role to remove it.', 'info');
      return;
    }
    setSaving(true);
    try {
      if (currentlyGranted && overrideSet.has(permId)) {
        // Revoke override
        await adminApi.revokePermissions(user.id, [permId]);
        setOverrides(prev => prev.filter(o => o.permission !== permId));
        showToast('Permission revoked', 'success');
      } else if (!currentlyGranted) {
        // Grant override
        await adminApi.grantPermissions(user.id, [permId]);
        setOverrides(prev => [...prev, { permission: permId, grantedBy: '', grantedAt: Date.now() / 1000 }]);
        showToast('Permission granted', 'success');
      }
      onChanged?.();
    } catch (err) {
      showToast((err as Error).message || 'Failed to update permission', 'error');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Permissions: ${user.firstName} ${user.lastName}`} size="lg">
      <div className="space-y-4">
        {/* Role badge */}
        <div className="flex items-center gap-2 text-sm text-muted">
          <Shield className="h-4 w-4" />
          <span>Role: <strong className="text-ink">{user.role.name}</strong></span>
          <Badge variant="outline">{user.role.permissions.length} base permissions</Badge>
          {overrideSet.size > 0 && (
            <Badge variant="success">+{overrideSet.size} extra</Badge>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            type="text"
            placeholder="Search permissions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted text-sm">Loading permissions...</div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {[...modules.entries()].map(([mod, perms]) => {
              const isExpanded = expandedModules.has(mod) || search.length > 0;
              return (
                <div key={mod} className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleModule(mod)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-ink hover:bg-primary-soft/50 transition-colors"
                  >
                    <span>{PERMISSION_MODULES[mod as keyof typeof PERMISSION_MODULES] || mod}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">
                        {perms.filter(p => rolePerms.has(p.id) || overrideSet.has(p.id)).length}/{perms.length}
                      </span>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border divide-y divide-border">
                      {perms.map(perm => {
                        const fromRole = rolePerms.has(perm.id);
                        const fromOverride = overrideSet.has(perm.id);
                        const granted = fromRole || fromOverride;
                        return (
                          <label
                            key={perm.id}
                            className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-primary-soft/30 transition-colors ${saving ? 'opacity-50 pointer-events-none' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={granted}
                              onChange={() => handleToggle(perm.id, granted)}
                              disabled={saving}
                              className="accent-primary h-4 w-4"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={granted ? 'text-ink' : 'text-muted'}>{perm.name}</span>
                                {fromOverride && (
                                  <Badge variant="success" className="text-[10px] px-1.5 py-0">extra</Badge>
                                )}
                                {fromRole && !fromOverride && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">role</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted truncate">{perm.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Audit log toggle */}
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setShowAudit(!showAudit)}
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Clock className="h-4 w-4" />
            {showAudit ? 'Hide' : 'Show'} permission history
          </button>
          {showAudit && (
            <div className="mt-3 max-h-[200px] overflow-y-auto">
              {audit.length === 0 ? (
                <p className="text-sm text-muted py-4 text-center">No permission changes recorded yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted border-b border-border">
                      <th className="py-1.5 pr-2">Date</th>
                      <th className="py-1.5 pr-2">Action</th>
                      <th className="py-1.5 pr-2">Detail</th>
                      <th className="py-1.5">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map(entry => (
                      <tr key={entry.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 text-muted whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                        <td className="py-1.5 pr-2">
                          <Badge variant={entry.action === 'grant' ? 'success' : entry.action === 'revoke' ? 'destructive' : 'default'}>
                            {entry.action === 'role_change' ? 'Role' : entry.action}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-ink">
                          {entry.action === 'role_change'
                            ? `${entry.oldRole || '?'} → ${entry.newRole || '?'}`
                            : entry.permission || ''}
                        </td>
                        <td className="py-1.5 text-muted">{entry.changedByName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
