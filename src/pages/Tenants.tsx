import { useState, useMemo } from 'react';
import { Plus, Search, Users, Mail, Phone, Calendar, Home, DollarSign, MoreHorizontal, Edit2, DoorOpen, MapPin, Pause, Ban, Eye, Upload, User, Play, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Tenant } from '../types';

const statusColors = {
  active: 'success',
  inactive: 'secondary',
  pending: 'warning',
  paused: 'warning',
} as const;

export function Tenants() {
  const { tenants, properties, units, updateTenant, deleteTenant, addTenant } = useApp();
  const { user } = useAuth();
  const { showToast } = useToast();
  const isSuperAdmin = user?.role?.name === 'Super Admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<Tenant['status'] | 'all'>('all');
  const [isAddTenantOpen, setIsAddTenantOpen] = useState(false);
  const [isEditTenantOpen, setIsEditTenantOpen] = useState(false);
  const [isViewTenantOpen, setIsViewTenantOpen] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState<string | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  // Form states
  const [newTenant, setNewTenant] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    propertyId: '',
    unitId: '',
    leaseStart: '',
    leaseEnd: '',
    monthlyRent: 0,
    securityDeposit: 0,
    notes: '',
  });

  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    leaseStart: '',
    leaseEnd: '',
    monthlyRent: 0,
    securityDeposit: 0,
    notes: '',
  });

  const [availableUnits, setAvailableUnits] = useState(
    units.filter(u => u.status === 'vacant')
  );

  const filteredTenants = useMemo(() => {
    return tenants.filter(tenant => {
      const fullName = `${tenant.firstName} ${tenant.lastName}`.toLowerCase();
      const matchesSearch = 
        fullName.includes(searchTerm.toLowerCase()) ||
        tenant.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tenant.phone.includes(searchTerm);
      
      const matchesStatus = statusFilter === 'all' || tenant.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [tenants, searchTerm, statusFilter]);

  const getProperty = (propertyId: string) => {
    return properties.find(p => p.id === propertyId);
  };

  const getUnit = (unitId: string) => {
    return units.find(u => u.id === unitId);
  };

  const getLeaseStatus = (leaseEnd: string) => {
    const endDate = new Date(leaseEnd);
    const today = new Date();
    const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilExpiry < 0) return { label: 'Expired', color: 'destructive' as const };
    if (daysUntilExpiry <= 30) return { label: `${daysUntilExpiry} days left`, color: 'warning' as const };
    return { label: 'Active', color: 'success' as const };
  };

  const handlePropertyChange = (propertyId: string) => {
    setNewTenant({...newTenant, propertyId, unitId: ''});
    setAvailableUnits(units.filter(u => u.propertyId === propertyId && u.status === 'vacant'));
  };

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addTenant({
        firstName: newTenant.firstName,
        lastName: newTenant.lastName,
        email: newTenant.email,
        phone: newTenant.phone,
        propertyId: newTenant.propertyId,
        unitId: newTenant.unitId,
        leaseStart: newTenant.leaseStart,
        leaseEnd: newTenant.leaseEnd,
        monthlyRent: Number(newTenant.monthlyRent),
        securityDeposit: Number(newTenant.securityDeposit),
        status: 'active',
        notes: newTenant.notes,
      });
      showToast('Tenant added successfully!', 'success');
      setIsAddTenantOpen(false);
      setNewTenant({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        propertyId: '',
        unitId: '',
        leaseStart: '',
        leaseEnd: '',
        monthlyRent: 0,
        securityDeposit: 0,
        notes: '',
      });
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  };

  const handleEditClick = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setEditForm({
      firstName: tenant.firstName,
      lastName: tenant.lastName,
      email: tenant.email,
      phone: tenant.phone,
      leaseStart: tenant.leaseStart,
      leaseEnd: tenant.leaseEnd,
      monthlyRent: tenant.monthlyRent,
      securityDeposit: tenant.securityDeposit,
      notes: tenant.notes || '',
    });
    setIsEditTenantOpen(true);
    setIsActionMenuOpen(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTenant) {
      try {
        await updateTenant(selectedTenant.id, {
          ...selectedTenant,
          ...editForm,
        });
        showToast('Tenant updated successfully!', 'success');
        setIsEditTenantOpen(false);
        setSelectedTenant(null);
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
  };

  const handleViewClick = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setIsViewTenantOpen(true);
    setIsActionMenuOpen(null);
  };

  const handleTerminateLease = async (tenantId: string) => {
    if (confirm('Are you sure you want to terminate this lease? The tenant will be marked as inactive.')) {
      try {
        await updateTenant(tenantId, { status: 'inactive' });
        showToast('Lease terminated', 'success');
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
    setIsActionMenuOpen(null);
  };

  const handlePauseRent = async (tenantId: string) => {
    if (confirm('Are you sure you want to pause rent for this tenant?')) {
      try {
        await updateTenant(tenantId, { status: 'paused' });
        showToast('Rent paused', 'success');
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
    setIsActionMenuOpen(null);
  };

  const handleResumeRent = async (tenantId: string) => {
    try {
      await updateTenant(tenantId, { status: 'active' });
      showToast('Rent resumed', 'success');
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
    setIsActionMenuOpen(null);
  };

  const handleDeleteTenant = async (tenantId: string) => {
    if (confirm('Are you sure you want to permanently delete this tenant? This action cannot be undone.')) {
      try {
        await deleteTenant(tenantId);
        showToast('Tenant deleted successfully', 'success');
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
    setIsActionMenuOpen(null);
  };

  const totalMonthlyRevenue = tenants
    .filter(t => t.status === 'active')
    .reduce((sum, t) => sum + t.monthlyRent, 0);

  const expiringSoon = tenants.filter(t => {
    const endDate = new Date(t.leaseEnd);
    const today = new Date();
    const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return t.status === 'active' && daysUntilExpiry <= 60 && daysUntilExpiry > 0;
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Manage your tenants and lease agreements
          </p>
        </div>
        <Button onClick={() => setIsAddTenantOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add Tenant
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tenants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tenants.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <Badge variant="success" className="h-2 w-2 p-0" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-positive">
              {tenants.filter(t => t.status === 'active').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{expiringSoon}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalMonthlyRevenue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tenants..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as Tenant['status'] | 'all')}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="pending">Pending</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {/* Tenants Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible -mx-4 sm:mx-0">
            <table className="w-full min-w-[800px] sm:min-w-0">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-4 font-medium">Tenant</th>
                  <th className="text-left py-3 px-4 font-medium">Property & Unit</th>
                  <th className="text-left py-3 px-4 font-medium">Contact</th>
                  <th className="text-left py-3 px-4 font-medium">Lease Period</th>
                  <th className="text-right py-3 px-4 font-medium">Rent</th>
                  <th className="text-center py-3 px-4 font-medium">Status</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map(tenant => {
                  const property = getProperty(tenant.propertyId);
                  const unit = getUnit(tenant.unitId);
                  const leaseStatus = getLeaseStatus(tenant.leaseEnd);
                  
                  return (
                    <tr key={tenant.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="font-semibold text-primary">
                              {tenant.firstName[0]}{tenant.lastName[0]}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium">{tenant.firstName} {tenant.lastName}</p>
                            <p className="text-xs text-muted-foreground">ID: #{tenant.id}</p>
                          </div>
                        </div>
                      </td>
                      
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Home className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{property?.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <DoorOpen className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Unit {unit?.unitNumber}</span>
                          </div>
                        </div>
                      </td>
                      
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{tenant.email}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{tenant.phone}</span>
                          </div>
                        </div>
                      </td>
                      
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            <span>{formatDate(tenant.leaseStart)} - {formatDate(tenant.leaseEnd)}</span>
                          </div>
                          <Badge variant={leaseStatus.color} className="text-xs">
                            {leaseStatus.label}
                          </Badge>
                        </div>
                      </td>
                      
                      <td className="py-4 px-4 text-right">
                        <p className="font-semibold">{formatCurrency(tenant.monthlyRent)}</p>
                        <p className="text-xs text-muted-foreground">/month</p>
                      </td>
                      
                      <td className="py-4 px-4 text-center">
                        <Badge variant={statusColors[tenant.status]}>
                          {tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}
                        </Badge>
                      </td>
                      
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 sm:gap-2 relative">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleViewClick(tenant)}
                            title="View Details"
                            className="px-2 sm:px-3"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleEditClick(tenant)}
                            title="Edit Tenant"
                            className="px-2 sm:px-3"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <div className="relative">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setIsActionMenuOpen(isActionMenuOpen === tenant.id ? null : tenant.id)}
                              title="More Actions"
                              className="px-2 sm:px-3"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                            
                            {isActionMenuOpen === tenant.id && (
                              <div className="absolute right-0 top-full mt-1 w-44 sm:w-48 bg-white rounded-lg shadow-lg border z-50 py-1">
                                <button
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2"
                                  onClick={() => {
                                    handleViewClick(tenant);
                                  }}
                                >
                                  <Eye className="h-4 w-4" />
                                  View Details
                                </button>
                                <button
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2"
                                  onClick={() => {
                                    handleEditClick(tenant);
                                  }}
                                >
                                  <Edit2 className="h-4 w-4" />
                                  Edit Information
                                </button>
                                <hr className="my-1" />
                                {tenant.status === 'active' && (
                                  <>
                                    <button
                                      className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2 text-warning"
                                      onClick={() => handlePauseRent(tenant.id)}
                                    >
                                      <Pause className="h-4 w-4" />
                                      Pause Rent
                                    </button>
                                    <button
                                      className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2 text-danger"
                                      onClick={() => handleTerminateLease(tenant.id)}
                                    >
                                      <Ban className="h-4 w-4" />
                                      Terminate Lease
                                    </button>
                                  </>
                                )}
                                {tenant.status === 'paused' && (
                                  <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2 text-positive"
                                    onClick={() => handleResumeRent(tenant.id)}
                                  >
                                    <Play className="h-4 w-4" />
                                    Resume Rent
                                  </button>
                                )}
                                {isSuperAdmin && (
                                  <>
                                    <hr className="my-1" />
                                    <button
                                      className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2 text-danger"
                                      onClick={() => handleDeleteTenant(tenant.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      Delete Tenant
                                    </button>
                                  </>
                                )}
                                <hr className="my-1" />
                                <button
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-black/[0.03] flex items-center gap-2 text-primary"
                                  onClick={() => {
                                    showToast('Document upload is coming soon.', 'info');
                                    setIsActionMenuOpen(null);
                                  }}
                                >
                                  <Upload className="h-4 w-4" />
                                  Upload Document
                                </button>
                              </div>
                            )}
                          </div>
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

      {filteredTenants.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No tenants found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      )}

      {/* View Tenant Modal */}
      <Modal
        isOpen={isViewTenantOpen}
        onClose={() => {
          setIsViewTenantOpen(false);
          setSelectedTenant(null);
        }}
        title="Tenant Details"
        size="lg"
      >
        {selectedTenant && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">
                  {selectedTenant.firstName[0]}{selectedTenant.lastName[0]}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-bold">{selectedTenant.firstName} {selectedTenant.lastName}</h3>
                <Badge variant={statusColors[selectedTenant.status]}>
                  {selectedTenant.status.charAt(0).toUpperCase() + selectedTenant.status.slice(1)}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" /> Contact Information
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {selectedTenant.email}
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    {selectedTenant.phone}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <Home className="h-4 w-4" /> Property Information
                </h4>
                <div className="space-y-2 text-sm">
                  <div>{getProperty(selectedTenant.propertyId)?.name}</div>
                  <div>Unit {getUnit(selectedTenant.unitId)?.unitNumber}</div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Lease Details
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Start Date: </span>
                  {formatDate(selectedTenant.leaseStart)}
                </div>
                <div>
                  <span className="text-muted-foreground">End Date: </span>
                  {formatDate(selectedTenant.leaseEnd)}
                </div>
                <div>
                  <span className="text-muted-foreground">Monthly Rent: </span>
                  {formatCurrency(selectedTenant.monthlyRent)}
                </div>
                <div>
                  <span className="text-muted-foreground">Security Deposit: </span>
                  {formatCurrency(selectedTenant.securityDeposit)}
                </div>
              </div>
            </div>

            {selectedTenant.notes && (
              <div className="space-y-2">
                <h4 className="font-semibold">Notes</h4>
                <p className="text-sm text-muted-foreground">{selectedTenant.notes}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setIsViewTenantOpen(false);
                  handleEditClick(selectedTenant);
                }}
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  showToast('Document upload is coming soon.', 'info');
                }}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Document
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Tenant Modal */}
      <Modal
        isOpen={isEditTenantOpen}
        onClose={() => {
          setIsEditTenantOpen(false);
          setSelectedTenant(null);
        }}
        title="Edit Tenant"
        size="lg"
      >
        {selectedTenant && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">First Name *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Last Name *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email *</label>
                <input
                  type="email"
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.email}
                  onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone *</label>
                <input
                  type="tel"
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                />
              </div>
            </div>
            
            <hr className="border-line" />
            
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Lease Details
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Lease Start *</label>
                <input
                  type="date"
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.leaseStart}
                  onChange={(e) => setEditForm({...editForm, leaseStart: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Lease End *</label>
                <input
                  type="date"
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.leaseEnd}
                  onChange={(e) => setEditForm({...editForm, leaseEnd: e.target.value})}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Monthly Rent *</label>
                <input
                  type="number"
                  required
                  min={0}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.monthlyRent}
                  onChange={(e) => setEditForm({...editForm, monthlyRent: parseInt(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Security Deposit *</label>
                <input
                  type="number"
                  required
                  min={0}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.securityDeposit}
                  onChange={(e) => setEditForm({...editForm, securityDeposit: parseInt(e.target.value)})}
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                placeholder="Any additional notes..."
              />
            </div>
            
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setIsEditTenantOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1">
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Tenant Modal */}
      <Modal
        isOpen={isAddTenantOpen}
        onClose={() => setIsAddTenantOpen(false)}
        title="Add New Tenant"
        size="lg"
      >
        <form onSubmit={handleAddTenant} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name *</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.firstName}
                onChange={(e) => setNewTenant({...newTenant, firstName: e.target.value})}
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name *</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.lastName}
                onChange={(e) => setNewTenant({...newTenant, lastName: e.target.value})}
                placeholder="Doe"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <input
                type="email"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.email}
                onChange={(e) => setNewTenant({...newTenant, email: e.target.value})}
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone *</label>
              <input
                type="tel"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.phone}
                onChange={(e) => setNewTenant({...newTenant, phone: e.target.value})}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>
          
          <hr className="border-line" />
          
          <h3 className="font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Property Assignment
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Property *</label>
              <select
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.propertyId}
                onChange={(e) => handlePropertyChange(e.target.value)}
              >
                <option value="">Select Property</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit *</label>
              <select
                required
                disabled={!newTenant.propertyId}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-[#efece5]"
                value={newTenant.unitId}
                onChange={(e) => {
                  const unit = units.find(u => u.id === e.target.value);
                  setNewTenant({
                    ...newTenant, 
                    unitId: e.target.value,
                    monthlyRent: unit?.monthlyRent || 0
                  });
                }}
              >
                <option value="">{newTenant.propertyId ? 'Select Unit' : 'Select Property First'}</option>
                {availableUnits.map(u => (
                  <option key={u.id} value={u.id}>
                    Unit {u.unitNumber} - {formatCurrency(u.monthlyRent)}/mo
                  </option>
                ))}
              </select>
              {newTenant.propertyId && availableUnits.length === 0 && (
                <p className="text-xs text-danger mt-1">No vacant units available</p>
              )}
            </div>
          </div>
          
          <hr className="border-line" />
          
          <h3 className="font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Lease Details
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Lease Start *</label>
              <input
                type="date"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.leaseStart}
                onChange={(e) => setNewTenant({...newTenant, leaseStart: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Lease End *</label>
              <input
                type="date"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.leaseEnd}
                onChange={(e) => setNewTenant({...newTenant, leaseEnd: e.target.value})}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Monthly Rent *</label>
              <input
                type="number"
                required
                min={0}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.monthlyRent}
                onChange={(e) => setNewTenant({...newTenant, monthlyRent: parseInt(e.target.value)})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Security Deposit *</label>
              <input
                type="number"
                required
                min={0}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={newTenant.securityDeposit}
                onChange={(e) => setNewTenant({...newTenant, securityDeposit: parseInt(e.target.value)})}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              value={newTenant.notes}
              onChange={(e) => setNewTenant({...newTenant, notes: e.target.value})}
              placeholder="Any additional notes..."
            />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddTenantOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Add Tenant
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
