import { useState } from 'react';
import { Plus, Search, Mail, Phone, Edit2, Trash2, UserCheck, UserX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { User } from '../types/auth';

export function Users() {
  const { users, roles, addUser, updateUser, deleteUser, hasPermission } = useAuth();
  const { showToast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roleId: '',
    department: '',
    isActive: true,
  });

  const canManageUsers = hasPermission('users_create') || hasPermission('users_edit') || hasPermission('users_delete');

  const filteredUsers = users.filter(user => {
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    const search = searchTerm.toLowerCase();
    return (
      fullName.includes(search) ||
      user.email.toLowerCase().includes(search) ||
      user.role.name.toLowerCase().includes(search) ||
      user.department?.toLowerCase().includes(search)
    );
  });

  const resetForm = () => {
    setUserForm({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      roleId: roles[0]?.id || '',
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

  const handleToggleStatus = async (user: User) => {
    try {
      await updateUser({ ...user, isActive: !user.isActive });
      showToast(`User ${user.isActive ? 'deactivated' : 'activated'}!`, 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to update user', 'error');
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
          <h1 className="text-3xl font-bold text-slate-800">Team Members</h1>
          <p className="text-slate-500 mt-1">Manage your team and their permissions</p>
        </div>
        {canManageUsers && (
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
            <div className="text-2xl font-bold text-emerald-600">{users.filter(u => u.isActive).length}</div>
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
            <div className="text-2xl font-bold text-blue-600">
              {users.filter(u => u.roleId === 'super_admin' || u.roleId === 'admin').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search team members..."
          className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Member</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Contact</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Role</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Department</th>
                  <th className="text-center py-3 px-4 font-semibold text-slate-700">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold">
                          {user.firstName[0]}{user.lastName[0]}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{user.firstName} {user.lastName}</p>
                          <p className="text-xs text-slate-500">Joined {new Date(user.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </td>
                    
                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-3 w-3 text-slate-400" />
                          <span className="text-slate-600">{user.email}</span>
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-3 w-3 text-slate-400" />
                            <span className="text-slate-600">{user.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    
                    <td className="py-4 px-4">
                      <Badge variant={getRoleBadgeColor(user.roleId)}>
                        {user.role.name}
                      </Badge>
                    </td>
                    
                    <td className="py-4 px-4 text-slate-600">
                      {user.department || '-'}
                    </td>
                    
                    <td className="py-4 px-4 text-center">
                      <button
                        onClick={() => handleToggleStatus(user)}
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          user.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
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
                        {canManageUsers && (
                          <>
                            <button
                              onClick={() => handleEditUser(user)}
                              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <Edit2 className="h-4 w-4 text-slate-500" />
                            </button>
                            {!user.role.isSystem && (
                              <button
                                onClick={() => setUserToDelete(user)}
                                className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add User Modal */}
      <Modal isOpen={isAddUserOpen} onClose={() => setIsAddUserOpen(false)} title="Add Team Member">
        <form onSubmit={handleAddUser} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={userForm.firstName} onChange={(e) => setUserForm({...userForm, firstName: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={userForm.lastName} onChange={(e) => setUserForm({...userForm, lastName: e.target.value})} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input type="email" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.email} onChange={(e) => setUserForm({...userForm, email: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.phone} onChange={(e) => setUserForm({...userForm, phone: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.roleId} onChange={(e) => setUserForm({...userForm, roleId: e.target.value})}>
              {roles.map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input type="text" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.department} onChange={(e) => setUserForm({...userForm, department: e.target.value})}
              placeholder="e.g., Property Management" />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" className="w-4 h-4 rounded border-slate-300"
              checked={userForm.isActive} onChange={(e) => setUserForm({...userForm, isActive: e.target.checked})} />
            <label htmlFor="isActive" className="text-sm text-slate-700">Active</label>
          </div>

          <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
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
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={userForm.firstName} onChange={(e) => setUserForm({...userForm, firstName: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={userForm.lastName} onChange={(e) => setUserForm({...userForm, lastName: e.target.value})} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input type="email" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.email} onChange={(e) => setUserForm({...userForm, email: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.phone} onChange={(e) => setUserForm({...userForm, phone: e.target.value})} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.roleId} onChange={(e) => setUserForm({...userForm, roleId: e.target.value})}>
              {roles.map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input type="text" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={userForm.department} onChange={(e) => setUserForm({...userForm, department: e.target.value})} />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="editIsActive" className="w-4 h-4 rounded border-slate-300"
              checked={userForm.isActive} onChange={(e) => setUserForm({...userForm, isActive: e.target.checked})} />
            <label htmlFor="editIsActive" className="text-sm text-slate-700">Active</label>
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
        message={`Are you sure you want to remove ${userToDelete?.firstName} ${userToDelete?.lastName}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
