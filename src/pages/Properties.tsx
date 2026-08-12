import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Building2, DollarSign, Home, DoorOpen, Edit2, Trash2, Check, ChevronDown, Droplet, Flame, Zap, Copy, ExternalLink } from 'lucide-react';

import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Property, Unit, LeaseStatus, UtilityAccount, UtilityType } from '../types';

const UTILITY_META: Record<UtilityType, { label: string; icon: typeof Droplet }> = {
  water: { label: 'Water', icon: Droplet },
  gas: { label: 'Gas', icon: Flame },
  electric: { label: 'Electric', icon: Zap },
};

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
    utilityAccounts, addUtilityAccount, updateUtilityAccount, deleteUtilityAccount,
    refreshData,
  } = useApp();
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  // Action buttons only appear when the signed-in role is allowed to do them,
  // so what a role can access on screen matches what the server enforces.
  const canCreateProperty = hasPermission('properties_create');
  const canEditProperty = hasPermission('properties_edit');
  const canDeleteProperty = hasPermission('properties_delete');
  const canCreateUnit = hasPermission('units_create');
  const canEditUnit = hasPermission('units_edit');
  const canDeleteUnit = hasPermission('units_delete');

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

  // Utility accounts (water/gas/electric per property).
  const [utilityModalOpen, setUtilityModalOpen] = useState(false);
  const [utilityProperty, setUtilityProperty] = useState<Property | null>(null);
  const [editingUtility, setEditingUtility] = useState<UtilityAccount | null>(null);
  const [utilityToDelete, setUtilityToDelete] = useState<UtilityAccount | null>(null);
  const [utilityForm, setUtilityForm] = useState({
    type: 'electric' as UtilityType,
    provider: '',
    accountNumber: '',
    unitId: '',
    loginUrl: '',
    notes: '',
  });
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  const openAddUtility = (property: Property) => {
    setUtilityProperty(property);
    setEditingUtility(null);
    setUtilityForm({ type: 'electric', provider: '', accountNumber: '', unitId: '', loginUrl: '', notes: '' });
    setUtilityModalOpen(true);
  };

  const openEditUtility = (property: Property, account: UtilityAccount) => {
    setUtilityProperty(property);
    setEditingUtility(account);
    setUtilityForm({
      type: account.type,
      provider: account.provider || '',
      accountNumber: account.accountNumber || '',
      unitId: account.unitId || '',
      loginUrl: account.loginUrl || '',
      notes: account.notes || '',
    });
    setUtilityModalOpen(true);
  };

  const handleSaveUtility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!utilityProperty) return;
    const payload = {
      propertyId: utilityProperty.id,
      type: utilityForm.type,
      provider: utilityForm.provider.trim() || undefined,
      accountNumber: utilityForm.accountNumber.trim() || undefined,
      unitId: utilityForm.unitId || undefined,
      loginUrl: utilityForm.loginUrl.trim() || undefined,
      notes: utilityForm.notes.trim() || undefined,
    };
    try {
      if (editingUtility) {
        await updateUtilityAccount({ ...editingUtility, ...payload });
        showToast('Utility account updated.', 'success');
      } else {
        await addUtilityAccount(payload);
        showToast('Utility account added.', 'success');
      }
      setUtilityModalOpen(false);
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  };

  const handleDeleteUtility = async () => {
    if (!utilityToDelete) return;
    try {
      await deleteUtilityAccount(utilityToDelete.id);
      showToast('Utility account removed.', 'success');
      setUtilityToDelete(null);
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  };

  const copyAccountNumber = async (account: UtilityAccount) => {
    if (!account.accountNumber) return;
    try {
      await navigator.clipboard.writeText(account.accountNumber);
      setCopiedAccount(account.id);
      setTimeout(() => setCopiedAccount(null), 1800);
    } catch { /* clipboard blocked; the number is visible to copy by hand */ }
  };

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
    // Purchase + tax details (drive the Tax Report's depreciation schedule).
    purchasePrice: '',
    purchaseDate: '',
    landValue: '',
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
      purchasePrice: '',
      purchaseDate: '',
      landValue: '',
    });
  };

  // Convert the string-based form into the numeric payload the API expects.
  const propertyPayload = () => ({
    name: propertyForm.name,
    address: propertyForm.address,
    city: propertyForm.city,
    state: propertyForm.state,
    zipCode: propertyForm.zipCode,
    type: propertyForm.type,
    description: propertyForm.description,
    purchasePrice: propertyForm.purchasePrice ? Number(propertyForm.purchasePrice) : undefined,
    purchaseDate: propertyForm.purchaseDate || undefined,
    landValue: propertyForm.landValue ? Number(propertyForm.landValue) : undefined,
  });

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
      await addProperty(propertyPayload());
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
      purchasePrice: property.purchasePrice != null ? String(property.purchasePrice) : '',
      purchaseDate: property.purchaseDate || '',
      landValue: property.landValue != null ? String(property.landValue) : '',
    });
    setIsEditPropertyOpen(true);
  };

  const handleUpdateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProperty) {
      try {
        await updateProperty({ ...selectedProperty, ...propertyPayload() });
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

  const occupancyPct = totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Properties</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
            <input
              type="text"
              placeholder="Search..."
              className="w-48 sm:w-56 pl-10 pr-4 py-2 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {canCreateProperty && (
            <Button onClick={() => setIsAddPropertyOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Property
            </Button>
          )}
        </div>
      </div>

      {/* Portfolio Summary */}
      <div className="grid gap-4 sm:gap-5 grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface rounded-2xl border border-line p-5 sm:p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-primary/[0.04] rounded-bl-[40px]" />
          <span className="text-xs font-medium text-muted uppercase tracking-wider">Properties</span>
          <p className="text-3xl sm:text-4xl font-display font-semibold text-ink tnum mt-2">{properties.length}</p>
          <div className="mt-3 w-8 h-8 rounded-xl bg-primary/10 text-primary grid place-items-center"><Building2 className="h-4 w-4" /></div>
        </div>

        <div className="bg-surface rounded-2xl border border-line p-5 sm:p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-primary/[0.04] rounded-bl-[40px]" />
          <span className="text-xs font-medium text-muted uppercase tracking-wider">Total Units</span>
          <p className="text-3xl sm:text-4xl font-display font-semibold text-ink tnum mt-2">{totalUnits}</p>
          <div className="mt-3 w-8 h-8 rounded-xl bg-primary/10 text-primary grid place-items-center"><DoorOpen className="h-4 w-4" /></div>
        </div>

        <div className="bg-surface rounded-2xl border border-line p-5 sm:p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-positive/[0.06] rounded-bl-[40px]" />
          <span className="text-xs font-medium text-muted uppercase tracking-wider">Occupancy</span>
          <p className="text-3xl sm:text-4xl font-display font-semibold text-positive tnum mt-2">{occupancyPct}%</p>
          <p className="text-xs text-muted mt-1">{occupiedUnits} of {totalUnits} occupied</p>
          <div className="mt-2 w-8 h-8 rounded-xl bg-positive/10 text-positive grid place-items-center"><Home className="h-4 w-4" /></div>
        </div>

        <div className="bg-surface rounded-2xl border border-line p-5 sm:p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-primary/[0.04] rounded-bl-[40px]" />
          <span className="text-xs font-medium text-muted uppercase tracking-wider">Monthly Revenue</span>
          <p className="text-3xl sm:text-4xl font-display font-semibold text-ink tnum mt-2">{formatCurrency(totalMonthlyRent)}</p>
          <p className="text-xs text-muted mt-1">Potential rent</p>
          <div className="mt-2 w-8 h-8 rounded-xl bg-primary/10 text-primary grid place-items-center"><DollarSign className="h-4 w-4" /></div>
        </div>
      </div>

      {/* Properties */}
      <div className="space-y-6">
        {filteredProperties.map(property => {
          const propertyUnits = getPropertyUnits(property.id);
          const occupiedCount = propertyUnits.filter(u => !!getUnitLease(u.id)).length;
          const vacantCount = propertyUnits.length - occupiedCount;
          const propUtilTypes = [...new Set(utilityAccounts.filter(u => u.propertyId === property.id).map(u => u.type))];
          const open = expanded.has(property.id);
          const propRent = propertyUnits.reduce((s, u) => s + u.monthlyRent, 0);

          return (
            <div key={property.id} className="rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow">
              {/* Property Header — rich gradient */}
              <div className="bg-gradient-to-br from-[#1e4a3a] via-[#24503f] to-[#2d6350] px-5 sm:px-6 py-5 sm:py-6 relative">
                {/* Subtle pattern overlay */}
                <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />

                <div className="relative flex items-start justify-between gap-4">
                  {/* Property info */}
                  <button
                    type="button"
                    onClick={() => toggleProperty(property.id)}
                    aria-expanded={open}
                    className="flex items-start gap-3 sm:gap-4 min-w-0 text-left"
                  >
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/15 backdrop-blur-sm grid place-items-center flex-shrink-0">
                      <Building2 className="h-6 w-6 sm:h-7 sm:w-7 text-white/90" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl sm:text-2xl font-display font-semibold text-white truncate">{property.name}</h3>
                        <ChevronDown className={`h-4 w-4 text-white/50 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                      </div>
                      <p className="text-sm text-white/70 truncate mt-0.5">{property.address}, {property.city}, {property.state} {property.zipCode}</p>
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-white/15 rounded-full px-2.5 py-1">
                          <DoorOpen className="h-3 w-3" />
                          {propertyUnits.length} {propertyUnits.length === 1 ? 'unit' : 'units'}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-200 bg-emerald-400/20 rounded-full px-2.5 py-1">
                          {occupiedCount} occupied
                        </span>
                        {vacantCount > 0 && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200 bg-amber-400/20 rounded-full px-2.5 py-1">
                            {vacantCount} vacant
                          </span>
                        )}
                        {propRent > 0 && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/90 bg-white/10 rounded-full px-2.5 py-1 tnum">
                            {formatCurrency(propRent)}/mo
                          </span>
                        )}
                        {propUtilTypes.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-white/60 bg-white/10 rounded-full px-2 py-1">
                            {propUtilTypes.map(t => { const M = UTILITY_META[t]; return M ? <M.icon key={t} className="h-3 w-3" /> : null; })}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Link to={`/properties/${property.id}`}>
                      <Button size="sm" variant="secondary" className="text-xs bg-white/15 border-white/20 text-white hover:bg-white/25">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Profile
                      </Button>
                    </Link>
                    {canCreateUnit && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs bg-white/15 border-white/20 text-white hover:bg-white/25"
                        onClick={() => {
                          setPropertyForUnit(property);
                          setIsAddUnitOpen(true);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Unit
                      </Button>
                    )}
                    {canEditProperty && (
                      <button
                        onClick={() => handleEditProperty(property)}
                        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/15 transition-colors"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canDeleteProperty && (
                      <button
                        onClick={() => setPropertyToDelete(property)}
                        className="p-1.5 rounded-lg text-white/60 hover:text-red-300 hover:bg-white/15 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {open && (
              <div className="bg-surface p-5 sm:p-6">
                {/* Units */}
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {propertyUnits.map(unit => {
                    const lease = getUnitLease(unit.id);
                    const occupants = lease ? getLeaseTenants(lease.id) : [];
                    const displayStatus: Unit['status'] = unit.status === 'maintenance'
                      ? 'maintenance'
                      : (lease ? 'occupied' : 'vacant');
                    const accentColor = displayStatus === 'occupied'
                      ? 'border-l-positive'
                      : displayStatus === 'maintenance'
                        ? 'border-l-danger'
                        : 'border-l-warning';
                    return (
                      <div
                        key={unit.id}
                        className={`border border-line border-l-[3px] ${accentColor} rounded-xl bg-white hover:shadow-md transition-all group`}
                      >
                        <div className="p-4">
                          {/* Unit header */}
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <span className="text-base font-semibold text-ink">Unit {unit.unitNumber}</span>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                                <span>{unit.bedrooms} bed</span>
                                <span className="text-line">·</span>
                                <span>{unit.bathrooms} bath</span>
                                {unit.squareFeet > 0 && <>
                                  <span className="text-line">·</span>
                                  <span>{unit.squareFeet.toLocaleString()} sqft</span>
                                </>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge variant={statusColors[displayStatus]} className="text-[10px] px-2">
                                {displayStatus}
                              </Badge>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                                {canEditUnit && (
                                  <button onClick={() => handleEditUnit(unit)} className="p-1 hover:bg-canvas rounded">
                                    <Edit2 className="h-3 w-3 text-muted" />
                                  </button>
                                )}
                                {canDeleteUnit && (
                                  <button onClick={() => setUnitToDelete(unit)} className="p-1 hover:bg-danger-soft rounded">
                                    <Trash2 className="h-3 w-3 text-danger" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Rent + Tenant */}
                          <div className="flex items-end justify-between pt-3 border-t border-line/60">
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted font-medium">Rent</p>
                              <p className="text-lg font-display font-semibold text-ink tnum">{formatCurrency(unit.monthlyRent)}</p>
                            </div>
                            <div className="text-right max-w-[150px]">
                              {lease ? (
                                <div className="flex items-center gap-1 text-xs justify-end flex-wrap">
                                  {occupants.length > 0 ? (
                                    occupants.map((t, i) => (
                                      <span key={t.id} className="whitespace-nowrap">
                                        <Link to={`/tenants/${t.id}`} className="text-primary hover:underline font-medium">
                                          {t.firstName} {t.lastName}
                                        </Link>{i < occupants.length - 1 ? ',' : ''}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-muted italic">Occupant unknown</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-faint italic">Available</span>
                              )}
                            </div>
                          </div>

                          {/* Lease details */}
                          {lease && (
                            <div className="mt-3 pt-3 border-t border-line/60 flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5">
                                <Badge variant={leaseStatusBadge[lease.status]} className="text-[10px]">
                                  {leaseStatusLabel[lease.status]}
                                </Badge>
                                <span className="text-muted tnum">
                                  {lease.startDate ? formatDate(lease.startDate) : '—'} to {lease.endDate ? formatDate(lease.endDate) : '—'}
                                </span>
                              </div>
                              {lease.monthlyRent !== unit.monthlyRent && (
                                <span className="font-medium text-ink tnum">{formatCurrency(lease.monthlyRent)}</span>
                              )}
                            </div>
                          )}

                          {/* Maintenance toggle */}
                          <div className="mt-3 pt-2 border-t border-line/60">
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
                      </div>
                    );
                  })}
                </div>

                {/* Utility accounts the landlord pays on this property */}
                <div className="mt-6 pt-6 border-t border-line">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2 text-ink text-sm">
                      <Zap className="h-4 w-4" />
                      Utilities
                    </h3>
                    {canEditProperty && (
                      <Button variant="outline" size="sm" onClick={() => openAddUtility(property)}>
                        <Plus className="h-4 w-4 mr-1.5" /> Add utility
                      </Button>
                    )}
                  </div>
                  {(() => {
                    const accts = utilityAccounts.filter(u => u.propertyId === property.id);
                    if (accts.length === 0) {
                      return <p className="text-sm text-muted">No utility accounts yet. Add the water, gas, and electric accounts you pay so the bills are quick to encode as expenses.</p>;
                    }
                    return (
                      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {accts.map(acct => {
                          const meta = UTILITY_META[acct.type];
                          const Icon = meta.icon;
                          const unit = acct.unitId ? propertyUnits.find(u => u.id === acct.unitId) : undefined;
                          return (
                            <div key={acct.id} className="border border-line rounded-xl p-3.5 bg-white">
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-8 h-8 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0"><Icon className="h-4 w-4" /></span>
                                  <div>
                                    <p className="text-sm font-medium text-ink leading-tight">{meta.label}</p>
                                    {acct.provider && <p className="text-xs text-muted">{acct.provider}</p>}
                                  </div>
                                </div>
                                {canEditProperty && (
                                  <div className="flex gap-1">
                                    <button onClick={() => openEditUtility(property, acct)} className="p-1 hover:bg-black/[0.05] rounded" title="Edit"><Edit2 className="h-3.5 w-3.5 text-muted" /></button>
                                    <button onClick={() => setUtilityToDelete(acct)} className="p-1 hover:bg-danger-soft rounded" title="Remove"><Trash2 className="h-3.5 w-3.5 text-danger" /></button>
                                  </div>
                                )}
                              </div>
                              {acct.accountNumber && (
                                <div className="mt-2.5 flex items-center justify-between gap-2 bg-canvas rounded-lg px-2.5 py-1.5">
                                  <div className="min-w-0">
                                    <p className="text-[10px] uppercase tracking-wide text-faint">Account #</p>
                                    <p className="text-sm text-ink truncate tnum">{acct.accountNumber}</p>
                                  </div>
                                  <button onClick={() => copyAccountNumber(acct)} className="p-1.5 text-faint hover:text-primary hover:bg-primary-soft rounded-md flex-shrink-0" title="Copy account number">
                                    {copiedAccount === acct.id ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                              )}
                              {(unit || acct.loginUrl || acct.notes) && (
                                <div className="mt-2 space-y-1 text-xs text-muted">
                                  {unit && <p>Serves Unit {unit.unitNumber}</p>}
                                  {acct.notes && <p className="whitespace-pre-wrap">{acct.notes}</p>}
                                  {acct.loginUrl && (
                                    <a href={acct.loginUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                      <ExternalLink className="h-3 w-3" /> Pay online
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
              )}
            </div>
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

          <div className="pt-2 border-t border-line space-y-4">
            <div>
              <p className="text-sm font-medium text-ink">Purchase &amp; tax details</p>
              <p className="text-xs text-muted mt-0.5">Used to calculate depreciation on the Tax Report.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Purchase price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                  <input type="number" min="0" step="0.01" className="w-full pl-7 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                    value={propertyForm.purchasePrice} onChange={(e) => setPropertyForm({...propertyForm, purchasePrice: e.target.value})} placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Purchase date</label>
                <input type="date" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={propertyForm.purchaseDate} onChange={(e) => setPropertyForm({...propertyForm, purchaseDate: e.target.value})} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Land value (not depreciable)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input type="number" min="0" step="0.01" className="w-full pl-7 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={propertyForm.landValue} onChange={(e) => setPropertyForm({...propertyForm, landValue: e.target.value})} placeholder="Leave blank to estimate 20% of price" />
              </div>
              <p className="text-xs text-muted mt-1">Land does not depreciate. Enter its assessed value from your county tax bill so only the building is depreciated. Blank assumes 20% of the price.</p>
            </div>
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

          <div className="pt-2 border-t border-line space-y-4">
            <div>
              <p className="text-sm font-medium text-ink">Purchase &amp; tax details</p>
              <p className="text-xs text-muted mt-0.5">Used to calculate depreciation on the Tax Report.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Purchase price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                  <input type="number" min="0" step="0.01" className="w-full pl-7 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                    value={propertyForm.purchasePrice} onChange={(e) => setPropertyForm({...propertyForm, purchasePrice: e.target.value})} placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Purchase date</label>
                <input type="date" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={propertyForm.purchaseDate} onChange={(e) => setPropertyForm({...propertyForm, purchaseDate: e.target.value})} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Land value (not depreciable)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input type="number" min="0" step="0.01" className="w-full pl-7 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                  value={propertyForm.landValue} onChange={(e) => setPropertyForm({...propertyForm, landValue: e.target.value})} placeholder="Leave blank to estimate 20% of price" />
              </div>
              <p className="text-xs text-muted mt-1">Land does not depreciate. Enter its assessed value from your county tax bill so only the building is depreciated. Blank assumes 20% of the price.</p>
            </div>
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

      {/* Add/Edit Utility Account Modal */}
      <Modal
        isOpen={utilityModalOpen}
        onClose={() => setUtilityModalOpen(false)}
        title={editingUtility ? 'Edit Utility Account' : `Add Utility${utilityProperty ? ` to ${utilityProperty.name}` : ''}`}
      >
        <form onSubmit={handleSaveUtility} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type *</label>
              <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={utilityForm.type} onChange={(e) => setUtilityForm({ ...utilityForm, type: e.target.value as UtilityType })}>
                <option value="electric">Electric</option>
                <option value="water">Water</option>
                <option value="gas">Gas</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Serves unit (optional)</label>
              <select className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={utilityForm.unitId} onChange={(e) => setUtilityForm({ ...utilityForm, unitId: e.target.value })}>
                <option value="">Whole property</option>
                {utilityProperty && getPropertyUnits(utilityProperty.id).map(u => (
                  <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Provider</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={utilityForm.provider} onChange={(e) => setUtilityForm({ ...utilityForm, provider: e.target.value })} placeholder="e.g., ComEd, Nicor Gas" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Account number</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
                value={utilityForm.accountNumber} onChange={(e) => setUtilityForm({ ...utilityForm, accountNumber: e.target.value })} placeholder="Account #" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Pay-online URL (optional)</label>
            <input type="url" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={utilityForm.loginUrl} onChange={(e) => setUtilityForm({ ...utilityForm, loginUrl: e.target.value })} placeholder="https://" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes (optional)</label>
            <textarea rows={2} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/30"
              value={utilityForm.notes} onChange={(e) => setUtilityForm({ ...utilityForm, notes: e.target.value })} placeholder="Meter number, autopay, etc." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setUtilityModalOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">{editingUtility ? 'Save Changes' : 'Add Utility'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!utilityToDelete}
        onClose={() => setUtilityToDelete(null)}
        onConfirm={handleDeleteUtility}
        title="Remove utility account"
        message={`Remove the ${utilityToDelete ? UTILITY_META[utilityToDelete.type].label.toLowerCase() : ''} account${utilityToDelete?.provider ? ` (${utilityToDelete.provider})` : ''}? This only removes the reference details, not any expenses.`}
        confirmText="Remove"
        variant="danger"
      />
    </div>
  );
}
