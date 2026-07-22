import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Mail, Phone, Edit2, Trash2, UserCheck, UserX, KeyRound, UserPlus, Image, ImageOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { adminApi, realtorsApi, tenantsApi, photoApi, handymenApi } from '../lib/api';
import { resizeImage } from '../lib/image';
import type { User } from '../types/auth';
import { userCategory, type UserCategory } from '../lib/userCategory';
import { HandymenManager } from '../components/HandymenManager';

export function Users() {
  const { user: currentUser, users, roles, addUser, updateUser, deleteUser, hasPermission } = useAuth();
  const { showToast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [tab, setTab] = useState<UserCategory>('internal');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ name: string; password: string } | null>(null);
  const [addTenantTarget, setAddTenantTarget] = useState<User | null>(null);

  // Realtor row photo controls: local overrides keyed by user id, since the
  // photo lives on the user row itself (photoApi.uploadUser/removeUser) and
  // the context list won't refresh until the next fetch.
  const [photoOverrides, setPhotoOverrides] = useState<Record<string, string | null>>({});
  const [photoTargetUserId, setPhotoTargetUserId] = useState<string | null>(null);
  const [photoBusyUserId, setPhotoBusyUserId] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roleId: '',
    department: '',
    isActive: true,
  });

  const [tenantForm, setTenantForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  // Add-tenant-for-realtor modal: link an existing unlinked tenant, or create new.
  const [addTenantMode, setAddTenantMode] = useState<'link' | 'create'>('link');
  const [unlinkedTenants, setUnlinkedTenants] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [addTenantBusy, setAddTenantBusy] = useState(false);
  // Handyman roster count for the Vendors tab (kept fresh by the manager below).
  const [handymanCount, setHandymanCount] = useState(0);

  useEffect(() => {
    handymenApi.getAll().then(h => setHandymanCount(h.length)).catch(() => {});
  }, []);

  const canManageUsers = hasPermission('users_create') || hasPermission('users_edit') || hasPermission('users_delete');

  // The Users page manages internal staff only. Portal roles (tenant, realtor,
  // handyman) are created in their own places, so they are never offered here.
  const assignableRoles = roles.filter(r => userCategory(r.id) === 'internal');

  const inTab = users.filter(u => userCategory(u.roleId) === tab);
  const filteredUsers = inTab.filter(user => {
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    const search = searchTerm.toLowerCase();
    return (
      fullName.includes(search) ||
      user.email.toLowerCase().includes(search) ||
      user.role.name.toLowerCase().includes(search) ||
      user.department?.toLowerCase().includes(search)
    );
  });

  const counts: Record<UserCategory, number> = {
    internal: users.filter(u => userCategory(u.roleId) === 'internal').length,
    realtor: users.filter(u => userCategory(u.roleId) === 'realtor').length,
    tenant: users.filter(u => userCategory(u.roleId) === 'tenant').length,
    handyman: users.filter(u => userCategory(u.roleId) === 'handyman').length,
  };
  // The Vendors tab holds business partners: realtors (role users) and handymen
  // (the maintenance roster). Handymen are counted separately from the users
  // table, so the tab count reflects both.
  const TABS: { key: UserCategory; label: string }[] = [
    { key: 'internal', label: 'Internal' },
    { key: 'realtor', label: 'Vendors' },
    { key: 'tenant', label: 'Tenants' },
  ];
  const tabCount = (key: UserCategory) => (key === 'realtor' ? counts.realtor + handymanCount : counts[key]);

  const resetForm = () => {
    setUserForm({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      roleId: assignableRoles[0]?.id || '',
      department: '',
      isActive: true,
    });
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await addUser(userForm);
      if (result?.tempPassword) {
        showToast(`User created. Temporary password: ${result.tempPassword} — share it securely.`, 'success');
      } else {
        showToast('User added successfully!', 'success');
      }
      setIsAddUserOpen(false);
      resetForm();
    } catch (err) {
      showToast((err as Error).message || 'Failed to add user', 'error');
    }
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setUserForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone || '',
      roleId: user.roleId,
      department: user.department || '',
      isActive: user.isActive,
    });
    setIsEditUserOpen(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      await updateUser({ ...selectedUser, ...userForm });
      showToast('User updated successfully!', 'success');
      setIsEditUserOpen(false);
      setSelectedUser(null);
      resetForm();
    } catch (err) {
      showToast((err as Error).message || 'Failed to update user', 'error');
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await deleteUser(userToDelete.id);
      showToast('User deleted successfully!', 'success');
      setUserToDelete(null);
    } catch (err) {
      showToast((err as Error).message || 'Failed to delete user', 'error');
    }
  };

  const handleResetPassword = async (user: User) => {
    const name = `${user.firstName} ${user.lastName}`;
    if (!confirm(`Generate a new temporary password for ${name}?\n\nTheir current password stops working immediately and they will be signed out.`)) return;
    try {
      const res = await adminApi.resetUserPassword(user.id);
      setTempPasswordInfo({ name, password: res.tempPassword });
    } catch (err) {
      showToast((err as Error).message || 'Could not reset the password', 'error');
    }
  };

  const handleToggleStatus = async (user: User) => {
    try {
      await updateUser({ ...user, isActive: !user.isActive });
      showToast(`User ${user.isActive ? 'deactivated' : 'activated'}!`, 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to update user', 'error');
    }
  };

  const openAddTenant = (user: User) => {
    setTenantForm({ firstName: '', lastName: '', email: '', phone: '' });
    setAddTenantMode('link');
    setSelectedTenantId('');
    setUnlinkedTenants([]);
    setAddTenantTarget(user);
    // Load the tenants with no realtor yet, for the "link existing" picker.
    tenantsApi.listUnlinked().then(setUnlinkedTenants).catch(() => setUnlinkedTenants([]));
  };

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addTenantTarget || addTenantBusy) return;
    setAddTenantBusy(true);
    try {
      if (addTenantMode === 'link') {
        if (!selectedTenantId) return;
        await tenantsApi.linkRealtor(selectedTenantId, addTenantTarget.id);
        showToast('Tenant linked to this realtor.', 'success');
      } else {
        await realtorsApi.addTenant(addTenantTarget.id, tenantForm);
        showToast('Tenant added for this realtor.', 'success');
      }
      setAddTenantTarget(null);
    } catch (err) {
      showToast((err as Error).message || 'Failed to add tenant', 'error');
    } finally {
      setAddTenantBusy(false);
    }
  };

  const openPhotoPicker = (user: User) => {
    setPhotoTargetUserId(user.id);
    photoInputRef.current?.click();
  };

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const userId = photoTargetUserId;
    if (!file || !userId || photoBusyUserId) {
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }
    setPhotoBusyUserId(userId);
    try {
      const blob = await resizeImage(file);
      const { photoUrl } = await photoApi.uploadUser(userId, blob);
      setPhotoOverrides(prev => ({ ...prev, [userId]: `${photoUrl}?t=${Date.now()}` }));
      showToast('Photo updated.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update the photo.', 'error');
    } finally {
      setPhotoBusyUserId(null);
      setPhotoTargetUserId(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handlePhotoRemove = async (user: User) => {
    if (photoBusyUserId) return;
    setPhotoBusyUserId(user.id);
    try {
      await photoApi.removeUser(user.id);
      setPhotoOverrides(prev => ({ ...prev, [user.id]: null }));
      showToast('Photo removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove the photo.', 'error');
    } finally {
      setPhotoBusyUserId(null);
    }
  };

  const getRoleBadgeColor = (roleId: string) => {
    switch (roleId) {
      case 'super_admin':
        return 'destructive';
      case 'admin':
        return 'default';
      case 'manager':
        return 'success';
      case 'viewer':
        return 'secondary';
      default:
        return 'warning';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">Users</h1>
          <p className="text-muted mt-1">Manage the people who can sign in and what they can do.</p>
        </div>
        {tab === 'internal' && canManageUsers && (
          <Button onClick={() => { resetForm(); setIsAddUserOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Member
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-positive">{users.filter(u => u.isActive).length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{roles.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {users.filter(u => u.roleId === 'super_admin' || u.roleId === 'admin').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
        <input
          type="text"
          placeholder="Search team members..."
          className="w-full pl-10 pr-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line mb-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label} <span className="text-faint">({tabCount(t.key)})</span>
          </button>
        ))}
      </div>

      {tab === 'tenant' && (
        <p className="text-muted text-sm mb-3">Tenants get portal access by inviting them from their own page.</p>
      )}
      {tab === 'realtor' && (
        <p className="text-muted text-sm mb-3">Your business partners. Realtors are added by linking them from a tenant's page; handymen are managed below.</p>
      )}

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink">Member</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink">Contact</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink">Role</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink">Department</th>
                  <th className="text-center py-3 px-4 font-semibold text-ink">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => {
                  const rowPhotoUrl = photoOverrides[user.id] !== undefined ? photoOverrides[user.id] : user.photoUrl;
                  return (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-black/[0.03]">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <Avatar
                          photoUrl={rowPhotoUrl}
                          initials={`${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`}
                          className="w-10 h-10"
                        />
                        <div>
                          <p className="font-medium text-ink">{user.firstName} {user.lastName}</p>
                          <p className="text-xs text-muted">Joined {new Date(user.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </td>
                    
                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-3 w-3 text-faint" />
                          <span className="text-muted">{user.email}</span>
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-3 w-3 text-faint" />
                            <span className="text-muted">{user.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    
                    <td className="py-4 px-4">
                      <Badge variant={getRoleBadgeColor(user.roleId)}>
                        {user.role.name}
                      </Badge>
                    </td>
                    
                    <td className="py-4 px-4 text-muted">
                      {user.department || '-'}
                    </td>
                    
                    <td className="py-4 px-4 text-center">
                      <button
                        onClick={() => handleToggleStatus(user)}
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          user.isActive
                            ? 'bg-positive-soft text-positive'
                            : 'bg-[#efece5] text-muted'
                        }`}
                      >
                        {user.isActive ? (
                          <><UserCheck className="h-3 w-3" /> Active</>
                        ) : (
                          <><UserX className="h-3 w-3" /> Inactive</>
                        )}
                      </button>
                    </td>
                    
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {tab === 'realtor' && hasPermission('tenants_create') && (
                          <button
                            onClick={() => openAddTenant(user)}
                            title="Add tenant"
                            className="p-2 hover:bg-primary-soft rounded-lg transition-colors"
                          >
                            <UserPlus className="h-4 w-4 text-muted" />
                          </button>
                        )}
                        {tab === 'realtor' && hasPermission('users_edit') && (
                          <>
                            <button
                              onClick={() => openPhotoPicker(user)}
                              disabled={photoBusyUserId === user.id}
                              title={rowPhotoUrl ? 'Change photo' : 'Add photo'}
                              className="p-2 hover:bg-primary-soft rounded-lg transition-colors disabled:opacity-50"
                            >
                              <Image className="h-4 w-4 text-muted" />
                            </button>
                            {rowPhotoUrl && (
                              <button
                                onClick={() => handlePhotoRemove(user)}
                                disabled={photoBusyUserId === user.id}
                                title="Remove photo"
                                className="p-2 hover:bg-danger-soft rounded-lg transition-colors disabled:opacity-50"
                              >
                                <ImageOff className="h-4 w-4 text-muted" />
                              </button>
                            )}
                          </>
                        )}
                        {canManageUsers && (
                          <>
                            <button
                              onClick={() => handleEditUser(user)}
                              title="Edit member"
                              className="p-2 hover:bg-black/[0.05] rounded-lg transition-colors"
                            >
                              <Edit2 className="h-4 w-4 text-muted" />
                            </button>
                            {/* Tenants reset their password from their own
                                profile (Tenants -> the person), so the tenant
                                tab has no reset here; staff and realtors keep it. */}
                            {tab !== 'tenant' && (
                              <button
                                onClick={() => handleResetPassword(user)}
                                title="Reset password"
                                className="p-2 hover:bg-primary-soft rounded-lg transition-colors"
                              >
                                <KeyRound className="h-4 w-4 text-muted" />
                              </button>
                            )}
                            {/* Show delete to anyone who can delete users, for
                                anyone but themselves. Tenants are the exception:
                                they are deleted from their own profile (Tenants
                                -> the person), which fully removes their lease,
                                rent, and records, so the tenant tab has no
                                delete. The server enforces the self/permission
                                rules. */}
                            {hasPermission('users_delete') && currentUser?.id !== user.id && tab !== 'tenant' && (
                              <button
                                onClick={() => setUserToDelete(user)}
                                title="Remove member"
                                className="p-2 hover:bg-danger-soft rounded-lg transition-colors"
                              >
                                <Trash2 className="h-4 w-4 text-danger" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Handymen (maintenance vendors) live on the Vendors tab, managed here
          rather than on the Maintenance page. */}
      {tab === 'realtor' && (
        <div className="mt-6">
          <HandymenManager onCountChange={setHandymanCount} />
        </div>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoPick}
      />

      {/* Add User Modal */}
      <Modal isOpen={isAddUserOpen} onClose={() => setIsAddUserOpen(false)} title="Add Team Member">
        <form onSubmit={handleAddUser} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={userForm.firstName} onChange={(e) => setUserForm({...userForm, firstName: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={userForm.lastName} onChange={(e) => setUserForm({...userForm, lastName: e.target.value})} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input type="email" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.email} onChange={(e) => setUserForm({...userForm, email: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.phone} onChange={(e) => setUserForm({...userForm, phone: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.roleId} onChange={(e) => setUserForm({...userForm, roleId: e.target.value})}>
              {assignableRoles.map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input type="text" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.department} onChange={(e) => setUserForm({...userForm, department: e.target.value})}
              placeholder="e.g., Property Management" />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" className="w-4 h-4 rounded border-line-strong"
              checked={userForm.isActive} onChange={(e) => setUserForm({...userForm, isActive: e.target.checked})} />
            <label htmlFor="isActive" className="text-sm text-ink">Active</label>
          </div>

          <p className="text-sm text-muted bg-canvas p-3 rounded-lg">
            A temporary password will be generated and shown to you after creating the user. Share it with them securely; they'll be prompted to change it on first login.
          </p>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddUserOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Add Member</Button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={isEditUserOpen} onClose={() => setIsEditUserOpen(false)} title="Edit Team Member">
        <form onSubmit={handleUpdateUser} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={userForm.firstName} onChange={(e) => setUserForm({...userForm, firstName: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={userForm.lastName} onChange={(e) => setUserForm({...userForm, lastName: e.target.value})} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input type="email" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.email} onChange={(e) => setUserForm({...userForm, email: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.phone} onChange={(e) => setUserForm({...userForm, phone: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.roleId} onChange={(e) => setUserForm({...userForm, roleId: e.target.value})}>
              {assignableRoles.map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input type="text" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={userForm.department} onChange={(e) => setUserForm({...userForm, department: e.target.value})} />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="editIsActive" className="w-4 h-4 rounded border-line-strong"
              checked={userForm.isActive} onChange={(e) => setUserForm({...userForm, isActive: e.target.checked})} />
            <label htmlFor="editIsActive" className="text-sm text-ink">Active</label>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsEditUserOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Update Member</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleDeleteUser}
        title="Delete Team Member"
        message={
          currentUser?.roleId === 'super_admin'
            ? 'This permanently deletes this account, purges their income and expense records, and reassigns any properties they own to you. This cannot be undone.'
            : `Are you sure you want to remove ${userToDelete?.firstName} ${userToDelete?.lastName}? This action cannot be undone.`
        }
        confirmText="Delete"
        variant="danger"
      />

      {/* Add Tenant (on behalf of a realtor) Modal */}
      <Modal
        isOpen={!!addTenantTarget}
        onClose={() => setAddTenantTarget(null)}
        title={`Add tenant for ${addTenantTarget ? `${addTenantTarget.firstName} ${addTenantTarget.lastName}` : 'this realtor'}`}
      >
        <form onSubmit={handleAddTenant} className="space-y-4">
          {/* Mode toggle: link an existing unlinked tenant, or create a new one. */}
          <div className="flex gap-1 p-1 bg-canvas border border-line rounded-lg">
            <button type="button" onClick={() => setAddTenantMode('link')}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${addTenantMode === 'link' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              Link existing tenant
            </button>
            <button type="button" onClick={() => setAddTenantMode('create')}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${addTenantMode === 'create' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              Create new tenant
            </button>
          </div>

          {addTenantMode === 'link' ? (
            unlinkedTenants.length === 0 ? (
              <p className="text-sm text-muted">Every tenant already has a realtor. Create a new one instead.</p>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">Tenant with no realtor yet</label>
                <select className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={selectedTenantId} onChange={(e) => setSelectedTenantId(e.target.value)}>
                  <option value="">Choose a tenant</option>
                  {unlinkedTenants.map(t => (
                    <option key={t.id} value={t.id}>{t.lastName}, {t.firstName}</option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">First Name *</label>
                  <input type="text" required={addTenantMode === 'create'} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                    value={tenantForm.firstName} onChange={(e) => setTenantForm({...tenantForm, firstName: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Last Name *</label>
                  <input type="text" required={addTenantMode === 'create'} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                    value={tenantForm.lastName} onChange={(e) => setTenantForm({...tenantForm, lastName: e.target.value})} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input type="email" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={tenantForm.email} onChange={(e) => setTenantForm({...tenantForm, email: e.target.value})} />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input type="tel" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={tenantForm.phone} onChange={(e) => setTenantForm({...tenantForm, phone: e.target.value})} />
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setAddTenantTarget(null)}>Cancel</Button>
            <Button type="submit" className="flex-1"
              disabled={addTenantBusy || (addTenantMode === 'link' && !selectedTenantId)}>
              {addTenantMode === 'link' ? 'Link Tenant' : 'Add Tenant'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Temporary password result */}
      <Modal
        isOpen={!!tempPasswordInfo}
        onClose={() => setTempPasswordInfo(null)}
        title="Temporary password"
      >
        {tempPasswordInfo && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              A new temporary password has been set for <span className="font-medium text-ink">{tempPasswordInfo.name}</span>.
              Share it with them securely. They'll be asked to choose a new one when they sign in.
            </p>
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-canvas border border-line rounded-lg">
              <code className="text-base text-ink tracking-wide break-all">{tempPasswordInfo.password}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(tempPasswordInfo.password);
                  showToast('Copied to clipboard', 'success');
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted">
              This is shown once. If you lose it, just reset the password again.
            </p>
            <Button className="w-full" onClick={() => setTempPasswordInfo(null)}>Done</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
