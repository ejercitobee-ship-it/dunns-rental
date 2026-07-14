import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Building2,
  DollarSign,
  Bell,
  Save,
  Mail,
  Smartphone,
  CreditCard,
  Users,
  Check,
  Plus,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { settingsApi } from '../lib/api';
import { SYSTEM_PERMISSIONS } from '../types/auth';
import type { Role } from '../types/auth';

export function Settings() {
  const { showToast } = useToast();
  const { roles, updateRole, addRole, deleteRole } = useAuth();
  const [activeTab, setActiveTab] = useState('company');
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const [companySettings, setCompanySettings] = useState({
    companyName: "DUNN's Rental",
    address: '123 Main Street',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90001',
    phone: '(555) 123-4567',
    email: 'contact@dunnsrental.com',
    taxId: '12-3456789',
  });

  const [rentSettings, setRentSettings] = useState({
    lateFeeAmount: 75,
    lateFeeDay: 5,
    gracePeriod: 3,
    defaultLeaseTerm: 12,
    securityDepositMultiplier: 2,
  });

  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: true,
    smsNotifications: false,
    rentReminders: true,
    leaseExpiryAlerts: true,
    maintenanceAlerts: true,
    paymentConfirmations: true,
  });

  const [roleForm, setRoleForm] = useState({
    name: '',
    description: '',
    permissions: [] as string[],
  });

  const [isSaving, setIsSaving] = useState(false);

  // Load saved settings from the server on mount.
  useEffect(() => {
    let active = true;
    settingsApi
      .get()
      .then((data) => {
        if (!active || !data) return;
        if (data.company) setCompanySettings(data.company);
        if (data.rent) setRentSettings(data.rent);
        if (data.notifications) setNotificationSettings(data.notifications);
      })
      .catch(() => {
        // Leave defaults in place if the load fails.
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await settingsApi.update({
        company: companySettings,
        rent: rentSettings,
        notifications: notificationSettings,
      });
      showToast('Settings saved successfully!', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to save settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePermission = async (roleId: string, permissionId: string) => {
    const role = roles.find(r => r.id === roleId);
    if (!role) return;

    const hadPermission = role.permissions.includes(permissionId);
    const newPermissions = hadPermission
      ? role.permissions.filter(p => p !== permissionId)
      : [...role.permissions, permissionId];

    try {
      await updateRole({ ...role, permissions: newPermissions });
      showToast(`Permission ${hadPermission ? 'removed' : 'added'}`, 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to update permission', 'error');
    }
  };

  const handleAddRole = async () => {
    if (!roleForm.name.trim()) return;
    try {
      await addRole({
        name: roleForm.name,
        description: roleForm.description,
        permissions: roleForm.permissions,
      });
      setRoleForm({ name: '', description: '', permissions: [] });
      setIsRoleModalOpen(false);
      showToast('Role created successfully!', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to create role', 'error');
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    if (confirm('Are you sure you want to delete this role?')) {
      try {
        await deleteRole(roleId);
        showToast('Role deleted!', 'success');
      } catch (err) {
        showToast((err as Error).message || 'Failed to delete role', 'error');
      }
    }
  };

  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setRoleForm({
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
    });
    setIsRoleModalOpen(true);
  };

  const handleUpdateRole = async () => {
    if (!editingRole || !roleForm.name.trim()) return;
    try {
      await updateRole({
        ...editingRole,
        name: roleForm.name,
        description: roleForm.description,
        permissions: roleForm.permissions,
      });
      setEditingRole(null);
      setRoleForm({ name: '', description: '', permissions: [] });
      setIsRoleModalOpen(false);
      showToast('Role updated successfully!', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Failed to update role', 'error');
    }
  };

  const toggleRolePermission = (permissionId: string) => {
    setRoleForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter(p => p !== permissionId)
        : [...prev.permissions, permissionId],
    }));
  };

  const tabs = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'rent', label: 'Rent', icon: DollarSign },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'team-access', label: 'Team Access', icon: Users },
  ];

  const moduleColors: Record<string, string> = {
    dashboard: 'bg-primary-soft text-primary',
    properties: 'bg-positive-soft text-emerald-800',
    tenants: 'bg-primary-soft text-violet-800',
    rents: 'bg-warning-soft text-amber-800',
    finances: 'bg-primary-soft text-cyan-800',
    users: 'bg-rose-100 text-rose-800',
    settings: 'bg-[#efece5] text-ink',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your application preferences
        </p>
      </div>

      <div className="flex gap-2 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Company Settings */}
      {activeTab === 'company' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Company Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.companyName}
                  onChange={(e) => setCompanySettings({...companySettings, companyName: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tax ID (EIN)</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.taxId}
                  onChange={(e) => setCompanySettings({...companySettings, taxId: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Address</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={companySettings.address}
                onChange={(e) => setCompanySettings({...companySettings, address: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">City</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.city}
                  onChange={(e) => setCompanySettings({...companySettings, city: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">State</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.state}
                  onChange={(e) => setCompanySettings({...companySettings, state: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">ZIP Code</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.zipCode}
                  onChange={(e) => setCompanySettings({...companySettings, zipCode: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Phone</label>
                <input
                  type="tel"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.phone}
                  onChange={(e) => setCompanySettings({...companySettings, phone: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={companySettings.email}
                  onChange={(e) => setCompanySettings({...companySettings, email: e.target.value})}
                />
              </div>
            </div>

            <Button onClick={handleSave} className="mt-4" disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Rent Settings */}
      {activeTab === 'rent' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Rent Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Late Fee Amount ($)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={rentSettings.lateFeeAmount}
                  onChange={(e) => setRentSettings({...rentSettings, lateFeeAmount: parseInt(e.target.value)})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Late Fee Applied After (Day)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={rentSettings.lateFeeDay}
                  onChange={(e) => setRentSettings({...rentSettings, lateFeeDay: parseInt(e.target.value)})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Grace Period (Days)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={rentSettings.gracePeriod}
                  onChange={(e) => setRentSettings({...rentSettings, gracePeriod: parseInt(e.target.value)})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Default Lease Term (Months)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={rentSettings.defaultLeaseTerm}
                  onChange={(e) => setRentSettings({...rentSettings, defaultLeaseTerm: parseInt(e.target.value)})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Security Deposit (Months of Rent)</label>
              <input
                type="number"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={rentSettings.securityDepositMultiplier}
                onChange={(e) => setRentSettings({...rentSettings, securityDepositMultiplier: parseInt(e.target.value)})}
              />
            </div>

            <Button onClick={handleSave} className="mt-4" disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Notification Settings */}
      {activeTab === 'notifications' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              {[
                { key: 'emailNotifications', label: 'Email Notifications', icon: Mail, desc: 'Receive notifications via email' },
                { key: 'smsNotifications', label: 'SMS Notifications', icon: Smartphone, desc: 'Receive notifications via text message' },
                { key: 'rentReminders', label: 'Rent Reminders', icon: DollarSign, desc: 'Remind tenants before rent is due' },
                { key: 'leaseExpiryAlerts', label: 'Lease Expiry Alerts', icon: Bell, desc: 'Alert when leases are expiring soon' },
                { key: 'maintenanceAlerts', label: 'Maintenance Alerts', icon: SettingsIcon, desc: 'Notify about maintenance requests' },
                { key: 'paymentConfirmations', label: 'Payment Confirmations', icon: CreditCard, desc: 'Send confirmation when rent is paid' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <item.icon className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={notificationSettings[item.key as keyof typeof notificationSettings]}
                      onChange={(e) => setNotificationSettings({...notificationSettings, [item.key]: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-[#dcd9d1] peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
              ))}
            </div>

            <Button onClick={handleSave} className="mt-4" disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Team Access Settings */}
      {activeTab === 'team-access' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Team Access Control</h2>
              <p className="text-muted-foreground">Manage roles and permissions for your team members</p>
            </div>
            <Button onClick={() => {
              setEditingRole(null);
              setRoleForm({ name: '', description: '', permissions: [] });
              setIsRoleModalOpen(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Role
            </Button>
          </div>

          <div className="space-y-4">
            {roles.map((role) => (
              <Card key={role.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{role.name}</h3>
                          {role.isSystem && (
                            <Badge variant="secondary" className="text-xs">System</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{role.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{role.permissions.length} permissions</Badge>
                      {!role.isSystem && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditRole(role);
                            }}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRole(role.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        </>
                      )}
                      {expandedRole === role.id ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {expandedRole === role.id && (
                    <div className="border-t px-4 py-4">
                      <h4 className="text-sm font-medium mb-3">Permissions</h4>
                      <div className="space-y-2">
                        {SYSTEM_PERMISSIONS.map((permission) => {
                          const isChecked = role.permissions.includes(permission.id);
                          return (
                            <div
                              key={permission.id}
                              className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                              onClick={() => {
                                handleTogglePermission(role.id, permission.id);
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                  isChecked
                                    ? 'bg-primary border-primary'
                                    : 'border-line-strong bg-surface'
                                }`}>
                                  {isChecked && <Check className="h-3.5 w-3.5 text-white stroke-[3]" />}
                                </div>
                                <div>
                                  <p className="text-sm font-medium">{permission.name}</p>
                                  <p className="text-xs text-muted-foreground">{permission.description}</p>
                                </div>
                              </div>
                              <Badge variant="outline" className={`text-xs ${moduleColors[permission.module] || ''}`}>
                                {permission.module}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Role Modal */}
      <Modal
        isOpen={isRoleModalOpen}
        onClose={() => {
          setIsRoleModalOpen(false);
          setEditingRole(null);
          setRoleForm({ name: '', description: '', permissions: [] });
        }}
        title={editingRole ? 'Edit Role' : 'Create New Role'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Role Name *</label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              value={roleForm.name}
              onChange={(e) => setRoleForm({...roleForm, name: e.target.value})}
              placeholder="e.g., Property Manager"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              value={roleForm.description}
              onChange={(e) => setRoleForm({...roleForm, description: e.target.value})}
              placeholder="Describe what this role can do..."
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Permissions</label>
            <div className="border rounded-lg max-h-96 overflow-y-auto">
              {SYSTEM_PERMISSIONS.map((permission) => {
                const isChecked = roleForm.permissions.includes(permission.id);
                return (
                  <div
                    key={permission.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer border-b last:border-0"
                    onClick={() => toggleRolePermission(permission.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'bg-primary border-primary'
                          : 'border-line-strong bg-surface'
                      }`}
                      >
                        {isChecked && <Check className="h-3.5 w-3.5 text-white stroke-[3]" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{permission.name}</p>
                        <p className="text-xs text-muted-foreground">{permission.description}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-xs ${moduleColors[permission.module] || ''}`}>
                      {permission.module}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setIsRoleModalOpen(false);
                setEditingRole(null);
                setRoleForm({ name: '', description: '', permissions: [] });
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!roleForm.name.trim()}
              onClick={editingRole ? handleUpdateRole : handleAddRole}
            >
              <Save className="h-4 w-4 mr-2" />
              {editingRole ? 'Update Role' : 'Create Role'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
