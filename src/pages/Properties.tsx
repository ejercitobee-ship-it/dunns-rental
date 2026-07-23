import { useRef, useState } from 'react';
import { Plus, Search, Building2, Bed, Bath, Square, DollarSign, Home, DoorOpen, Users, Edit2, Trash2, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type { Property, Unit, LeaseStatus } from '../types';

const statusColors = {
  occupied: 'success',
  vacant: 'warning',
  maintenance: 'destructive',
} as const;

const leaseStatusBadge: Record<LeaseStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  ended: 'secondary',
};

const leaseStatusLabel: Record<LeaseStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

export function Properties() {
  const {
    properties, units,
    addProperty, updateProperty, deleteProperty,
    addUnit, updateUnit, deleteUnit,
    getPropertyUnits, getUnitLease, getLeaseTenants,
    refreshData,
  } = useApp();
  const { showToast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  // Each property collapses so the page stays tidy as more are added. Collapsed
  // by default; the header still shows the unit summary and all property actions.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleProperty = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const [isAddPropertyOpen, setIsAddPropertyOpen] = useState(false);
  const [isEditPropertyOpen, setIsEditPropertyOpen] = useState(false);
  const [isAddUnitOpen, setIsAddUnitOpen] = useState(false);
  const [isEditUnitOpen, setIsEditUnitOpen] = useState(false);
  const [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null);
  const [unitToDelete, setUnitToDelete] = useState<Unit | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [propertyForUnit, setPropertyForUnit] = useState<Property | null>(null);

  // Synchronous re-entry guards for the two submits that create a new record
  // (a property, a unit). A useState-based "isSubmitting" flag only takes
  // effect after a render, so a fast double click or double Enter can start
  // a second overlapping submit before that render lands and create a
  // duplicate record. These refs are set the instant the first submit
  // starts, so a second invocation sees it immediately and bails out.
  const isAddingPropertyRef = useRef(false);
  const isAddingUnitRef = useRef(false);

  // Form states
  const [propertyForm, setPropertyForm] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    type: 'apartment' as Property['type'],
    description: '',
  });

  const [unitForm, setUnitForm] = useState({
    unitNumber: '',
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 0,
    monthlyRent: 0,
    description: '',
    status: 'vacant' as Unit['status'],
  });

  const filteredProperties = properties.filter(property => {
    const matchesSearch = 
      property.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      property.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      property.city.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const resetPropertyForm = () => {
    setPropertyForm({
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      type: 'apartment',
      description: '',
    });
  };

  const resetUnitForm = () => {
    setUnitForm({
      unitNumber: '',
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 0,
      monthlyRent: 0,
      description: '',
      status: 'vacant',
    });
  };

  const handleAddProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAddingPropertyRef.current) return;
    isAddingPropertyRef.current = true;
    try {
      await addProperty(propertyForm);
      showToast('Property added successfully!', 'success');
      setIsAddPropertyOpen(false);
      resetPropertyForm();
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      isAddingPropertyRef.current = false;
    }
  };

  const handleEditProperty = (property: Property) => {
    setSelectedProperty(property);
    setPropertyForm({
      name: property.name,
      address: property.address,
      city: property.city,
      state: property.state,
      zipCode: property.zipCode,
      type: property.type,
      description: property.description || '',
    });
    setIsEditPropertyOpen(true);
  };

  const handleUpdateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProperty) {
      try {
        await updateProperty({ ...selectedProperty, ...propertyForm });
        showToast('Property updated successfully!', 'success');
        setIsEditPropertyOpen(false);
        setSelectedProperty(null);
        resetPropertyForm();
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
  };

  const handleDeleteProperty = async () => {
    if (propertyToDelete) {
      try {
        await deleteProperty(propertyToDelete.id);
        showToast('Property deleted successfully!', 'success');
        setPropertyToDelete(null);
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAddingUnitRef.current) return;
    if (propertyForUnit) {
      isAddingUnitRef.current = true;
      try {
        await addUnit({ ...unitForm, propertyId: propertyForUnit.id });
        showToast('Unit added successfully!', 'success');
        setIsAddUnitOpen(false);
        setPropertyForUnit(null);
        resetUnitForm();
      } catch (error) {
        showToast((error as Error).message, 'error');
      } finally {
        isAddingUnitRef.current = false;
      }
    }
  };

  const handleEditUnit = (unit: Unit) => {
    setSelectedUnit(unit);
    setUnitForm({
      unitNumber: unit.unitNumber,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      squareFeet: unit.squareFeet,
      monthlyRent: unit.monthlyRent,
      description: unit.description || '',
      status: unit.status,
    });
    setIsEditUnitOpen(true);
  };

  const handleUpdateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUnit) {
      try {
        // Occupied and vacant are derived from whether the unit has a
        // tenancy, never stored by hand, so every save re-derives them here
        // instead of trusting whatever the form last held. That keeps a
        // stale stored value from ever disagreeing with what the page
        // displays. Maintenance is the one state a lease can't express, so
        // it is the only piece of unitForm.status the owner actually chose.
        const status: Unit['status'] = unitForm.status === 'maintenance'
          ? 'maintenance'
          : (getUnitLease(selectedUnit.id) ? 'occupied' : 'vacant');
        await updateUnit({ ...selectedUnit, ...unitForm, status });
        showToast('Unit updated successfully!', 'success');
        setIsEditUnitOpen(false);
        setSelectedUnit(null);
        resetUnitForm();
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
  };

  const handleDeleteUnit = async () => {
    if (unitToDelete) {
      try {
        await deleteUnit(unitToDelete.id);
        // The server clears unitId on any lease that pointed at this unit
        // (ON DELETE SET NULL) so lease and payment history survive, but the
        // in-memory DELETE_UNIT reducer only removes the unit itself: it
        // does not touch leases. Without this refresh, a lease that used to
        // point here would keep showing a unitId for a unit that no longer
        // exists until the next full reload.
        await refreshData();
        showToast('Unit deleted successfully!', 'success');
        setUnitToDelete(null);
      } catch (error) {
        showToast((error as Error).message, 'error');
      }
    }
  };

  // Maintenance is the only unit state a lease cannot express, so it is the
  // only status the owner ever sets by hand. Occupied and vacant are always
  // derived from whether the unit currently has a lease.
  const handleToggleMaintenance = async (unit: Unit) => {
    const nextStatus: Unit['status'] = unit.status === 'maintenance'
      ? (getUnitLease(unit.id) ? 'occupied' : 'vacant')
      : 'maintenance';
    try {
      await updateUnit({ ...unit, status: nextStatus });
      showToast(
        nextStatus === 'maintenance' ? 'Unit marked as under maintenance.' : 'Maintenance cleared.',
        'success'
      );
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  };

  const totalUnits = units.length;
  const occupiedUnits = units.filter(u => !!getUnitLease(u.id)).length;
  const totalMonthlyRent = units.reduce((sum, u) => sum + u.monthlyRent, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">Properties</h1>
          <p className="text-muted mt-1 text-sm sm:text-base">Manage your rental properties and units</p>
        </div>
        <Button onClick={() => setIsAddPropertyOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add Property
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Properties</CardTitle>
            <Building2 className="h-4 w-4 text-faint" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{properties.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Units</CardTitle>
            <DoorOpen className="h-4 w-4 text-faint" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUnits}</div>
            <p className="text-xs text-muted">Across all properties</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Occupied Units</CardTitle>
            <Badge variant="success" className="h-2 w-2 p-0" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-positive">{occupiedUnits}</div>
            <p className="text-xs text-muted">{totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(0) : 0}% occupancy</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Potential Rent</CardTitle>
            <DollarSign className="h-4 w-4 text-faint" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalMonthlyRent)}</div>
            <p className="text-xs text-muted">Per month</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search properties..."
            className="w-full pl-10 pr-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Properties List */}
      <div className="space-y-6">
        {filteredProperties.map(property => {
          const propertyUnits = getPropertyUnits(property.id);
          const occupiedCount = propertyUnits.filter(u => !!getUnitLease(u.id)).length;
          const open = expanded.has(property.id);

          return (
            <Card key={property.id} className="overflow-hidden">
              <div className="h-24 sm:h-32 bg-gradient-to-br from-[#2b5a48] to-[#1c4032] flex items-center justify-between px-4 sm:px-6 relative">
                <button
                  type="button"
                  onClick={() => toggleProperty(property.id)}
                  aria-expanded={open}
                  className="flex items-center gap-2 sm:gap-3 min-w-0 text-left group/toggle"
                >
                  {open
                    ? <ChevronDown className="h-5 w-5 text-white/70 flex-shrink-0" />
                    : <ChevronRight className="h-5 w-5 text-white/70 flex-shrink-0" />}
                  <Building2 className="h-8 w-8 sm:h-11 sm:w-11 text-white/50 flex-shrink-0" />
                  <div className="text-white min-w-0">
                    <h3 className="text-lg sm:text-xl font-bold truncate">{property.name}</h3>
                    <p className="text-white/80 text-xs sm:text-sm truncate">{property.address}, {property.city}</p>
                    <p className="text-white/70 text-xs mt-0.5">
                      {propertyUnits.length} {propertyUnits.length === 1 ? 'unit' : 'units'} · {occupiedCount} occupied · {propertyUnits.length - occupiedCount} vacant
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => {
                      setPropertyForUnit(property);
                      setIsAddUnitOpen(true);
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Unit
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="text-white hover:bg-white/20"
                    onClick={() => handleEditProperty(property)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="text-white hover:bg-white/20 hover:text-red-200"
                    onClick={() => setPropertyToDelete(property)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {open && (
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2 text-ink">
                    <DoorOpen className="h-5 w-5" />
                    Units ({propertyUnits.length})
                  </h3>
                  <div className="text-sm text-muted">
                    <span className="text-positive font-semibold">{occupiedCount} occupied</span>
                    <span className="mx-2">•</span>
                    <span>{propertyUnits.length - occupiedCount} vacant</span>
                  </div>
                </div>
                
                <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {propertyUnits.map(unit => {
                    const lease = getUnitLease(unit.id);
                    const occupants = lease ? getLeaseTenants(lease.id) : [];
                    // Occupied and vacant are derived from whether the unit
                    // currently has a lease, never read from the stored
                    // field, so the badge below can never disagree with
                    // reality. Maintenance is a real, separate fact a lease
                    // cannot express, so it is the one piece of unit.status
                    // still read directly.
                    const displayStatus: Unit['status'] = unit.status === 'maintenance'
                      ? 'maintenance'
                      : (lease ? 'occupied' : 'vacant');
                    return (
                      <div
                        key={unit.id}
                        className="border border-line rounded-xl p-4 hover:shadow-lg transition-all bg-white group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Home className="h-4 w-4 text-faint" />
                            <span className="font-semibold text-ink">Unit {unit.unitNumber}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant={statusColors[displayStatus]} className="text-xs">
                              {displayStatus}
                            </Badge>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                              <button
                                onClick={() => handleEditUnit(unit)}
                                className="p-1 hover:bg-black/[0.05] rounded"
                              >
                                <Edit2 className="h-3 w-3 text-muted" />
                              </button>
                              <button
                                onClick={() => setUnitToDelete(unit)}
                                className="p-1 hover:bg-danger-soft rounded"
                              >
                                <Trash2 className="h-3 w-3 text-danger" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center mb-3">
                          <div className="bg-canvas rounded-lg p-2">
                            <Bed className="h-3 w-3 mx-auto mb-1 text-faint" />
                            <p className="text-xs font-medium text-ink">{unit.bedrooms}</p>
                          </div>
                          <div className="bg-canvas rounded-lg p-2">
                            <Bath className="h-3 w-3 mx-auto mb-1 text-faint" />
                            <p className="text-xs font-medium text-ink">{unit.bathrooms}</p>
                          </div>
                          <div className="bg-canvas rounded-lg p-2">
                            <Square className="h-3 w-3 mx-auto mb-1 text-faint" />
                            <p className="text-xs font-medium text-ink">{unit.squareFeet}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-line">
                          <div>
                            <p className="text-xs text-muted">Rent</p>
                            <p className="font-semibold text-positive">{formatCurrency(unit.monthlyRent)}</p>
                          </div>
                          <div className="text-right">
                            {lease ? (
                              <div className="flex items-center gap-1 text-xs text-muted justify-end">
                                <Users className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate max-w-[160px]">
                                  {occupants.length > 0
                                    ? occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ')
                                    : 'Occupant unknown'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-faint">Vacant</span>
                            )}
                          </div>
                        </div>

                        {lease && (
                          <div className="mt-3 pt-3 border-t border-line space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted">Current tenancy</span>
                              <Badge variant={leaseStatusBadge[lease.status]} className="text-xs">
                                {leaseStatusLabel[lease.status]}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted">Rent</span>
                              <span className="font-medium text-ink tnum">{formatCurrency(lease.monthlyRent)}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted">Term</span>
                              <span className="text-ink">
                                {lease.startDate ? formatDate(lease.startDate) : '—'} to {lease.endDate ? formatDate(lease.endDate) : '—'}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Maintenance is the only state here the owner sets
                            by hand; occupied and vacant above always come
                            from whether the unit has a lease. */}
                        <div className="mt-3 pt-2 border-t border-line">
                          <button
                            type="button"
                            onClick={() => handleToggleMaintenance(unit)}
                            className={`w-full py-1.5 px-2 text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                              unit.status === 'maintenance'
                                ? 'bg-danger-soft text-danger font-medium'
                                : 'bg-canvas text-muted hover:bg-black/[0.05]'
                            }`}
                          >
                            {unit.status === 'maintenance' && <Check className="h-3 w-3" />}
                            {unit.status === 'maintenance' ? 'Under maintenance' : 'Mark as under maintenance'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Add Property Modal */}
      <Modal isOpen={isAddPropertyOpen} onClose={() => setIsAddPropertyOpen(false)} title="Add New Property">
        <form onSubmit={handleAddProperty} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Property Name *</label>
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={propertyForm.name} onChange={(e) => setPropertyForm({...propertyForm, name: e.target.value})} placeholder="e.g., Sunset Apartments" />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Address *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.address} onChange={(e) => setPropertyForm({...propertyForm, address: e.target.value})} placeholder="Street address" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.city} onChange={(e) => setPropertyForm({...propertyForm, city: e.target.value})} placeholder="City" />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">State *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.state} onChange={(e) => setPropertyForm({...propertyForm, state: e.target.value})} placeholder="CA" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ZIP Code *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.zipCode} onChange={(e) => setPropertyForm({...propertyForm, zipCode: e.target.value})} placeholder="90001" />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Property Type *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={propertyForm.type} onChange={(e) => setPropertyForm({...propertyForm, type: e.target.value as Property['type']})}>
              <option value="apartment">Apartment</option>
              <option value="house">House</option>
              <option value="condo">Condo</option>
              <option value="townhouse">Townhouse</option>
              <option value="multi-family">Multi-Family</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30" rows={3}
              value={propertyForm.description} onChange={(e) => setPropertyForm({...propertyForm, description: e.target.value})} placeholder="Brief description..." />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddPropertyOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Add Property</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Property Modal */}
      <Modal isOpen={isEditPropertyOpen} onClose={() => setIsEditPropertyOpen(false)} title="Edit Property">
        <form onSubmit={handleUpdateProperty} className="space-y-4">
          {/* Same form fields as Add Property */}
          <div>
            <label className="block text-sm font-medium mb-1">Property Name *</label>
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={propertyForm.name} onChange={(e) => setPropertyForm({...propertyForm, name: e.target.value})} />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Address *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.address} onChange={(e) => setPropertyForm({...propertyForm, address: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.city} onChange={(e) => setPropertyForm({...propertyForm, city: e.target.value})} />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">State *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.state} onChange={(e) => setPropertyForm({...propertyForm, state: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ZIP Code *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={propertyForm.zipCode} onChange={(e) => setPropertyForm({...propertyForm, zipCode: e.target.value})} />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Property Type *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={propertyForm.type} onChange={(e) => setPropertyForm({...propertyForm, type: e.target.value as Property['type']})}>
              <option value="apartment">Apartment</option>
              <option value="house">House</option>
              <option value="condo">Condo</option>
              <option value="townhouse">Townhouse</option>
              <option value="multi-family">Multi-Family</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30" rows={3}
              value={propertyForm.description} onChange={(e) => setPropertyForm({...propertyForm, description: e.target.value})} />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsEditPropertyOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Update Property</Button>
          </div>
        </form>
      </Modal>

      {/* Add Unit Modal */}
      <Modal isOpen={isAddUnitOpen} onClose={() => setIsAddUnitOpen(false)} title={propertyForUnit ? `Add Unit to ${propertyForUnit.name}` : 'Add Unit'}>
        <form onSubmit={handleAddUnit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Unit Number *</label>
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={unitForm.unitNumber} onChange={(e) => setUnitForm({...unitForm, unitNumber: e.target.value})} placeholder="e.g., 101, A, 2B" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bedrooms *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.bedrooms} onChange={(e) => setUnitForm({...unitForm, bedrooms: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bathrooms *</label>
              <input type="number" required min={0} step={0.5} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.bathrooms} onChange={(e) => setUnitForm({...unitForm, bathrooms: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Square Feet *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.squareFeet} onChange={(e) => setUnitForm({...unitForm, squareFeet: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Monthly Rent *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.monthlyRent} onChange={(e) => setUnitForm({...unitForm, monthlyRent: parseInt(e.target.value)})} />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30" rows={2}
              value={unitForm.description} onChange={(e) => setUnitForm({...unitForm, description: e.target.value})} placeholder="Unit description..." />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddUnitOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Add Unit</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Unit Modal */}
      <Modal isOpen={isEditUnitOpen} onClose={() => setIsEditUnitOpen(false)} title="Edit Unit">
        <form onSubmit={handleUpdateUnit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Unit Number *</label>
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={unitForm.unitNumber} onChange={(e) => setUnitForm({...unitForm, unitNumber: e.target.value})} />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bedrooms *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.bedrooms} onChange={(e) => setUnitForm({...unitForm, bedrooms: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bathrooms *</label>
              <input type="number" required min={0} step={0.5} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.bathrooms} onChange={(e) => setUnitForm({...unitForm, bathrooms: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Square Feet *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.squareFeet} onChange={(e) => setUnitForm({...unitForm, squareFeet: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Monthly Rent *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={unitForm.monthlyRent} onChange={(e) => setUnitForm({...unitForm, monthlyRent: parseInt(e.target.value)})} />
            </div>
          </div>
          
          <div>
            <label className="flex items-center gap-2 text-sm font-medium mb-1">
              <input
                type="checkbox"
                checked={unitForm.status === 'maintenance'}
                onChange={(e) => setUnitForm({
                  ...unitForm,
                  status: e.target.checked
                    ? 'maintenance'
                    : (selectedUnit && getUnitLease(selectedUnit.id) ? 'occupied' : 'vacant'),
                })}
              />
              Under maintenance
            </label>
            <p className="text-xs text-muted mt-1">
              Occupied and vacant are set automatically from the unit's current tenancy and cannot be edited here.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsEditUnitOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Update Unit</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Property Confirmation */}
      <ConfirmDialog
        isOpen={!!propertyToDelete}
        onClose={() => setPropertyToDelete(null)}
        onConfirm={handleDeleteProperty}
        title="Delete Property"
        message={`Are you sure you want to delete "${propertyToDelete?.name}"? This will also delete all associated units and cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      {/* Delete Unit Confirmation */}
      <ConfirmDialog
        isOpen={!!unitToDelete}
        onClose={() => setUnitToDelete(null)}
        onConfirm={handleDeleteUnit}
        title="Delete Unit"
        message={
          unitToDelete && getUnitLease(unitToDelete.id)
            ? `Unit ${unitToDelete.unitNumber} has a current tenancy. Deleting the unit will not end that tenancy: the lease and its payment history will remain, but they will no longer be linked to a unit. This cannot be undone. Continue?`
            : `Are you sure you want to delete Unit ${unitToDelete?.unitNumber}? This action cannot be undone.`
        }
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
