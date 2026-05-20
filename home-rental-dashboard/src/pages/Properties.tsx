import { useState } from 'react';
import { Plus, Search, Building2, Bed, Bath, Square, DollarSign, Home, DoorOpen, Users, Edit2, Trash2, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type { Property, Unit } from '../types';

const statusColors = {
  occupied: 'success',
  vacant: 'warning',
  maintenance: 'destructive',
} as const;

export function Properties() {
  const { 
    properties, units, 
    addProperty, updateProperty, deleteProperty,
    addUnit, updateUnit, deleteUnit,
    getPropertyUnits, getUnitTenant 
  } = useApp();
  const { showToast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddPropertyOpen, setIsAddPropertyOpen] = useState(false);
  const [isEditPropertyOpen, setIsEditPropertyOpen] = useState(false);
  const [isAddUnitOpen, setIsAddUnitOpen] = useState(false);
  const [isEditUnitOpen, setIsEditUnitOpen] = useState(false);
  const [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null);
  const [unitToDelete, setUnitToDelete] = useState<Unit | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [propertyForUnit, setPropertyForUnit] = useState<Property | null>(null);

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

  const handleAddProperty = (e: React.FormEvent) => {
    e.preventDefault();
    addProperty(propertyForm);
    showToast('Property added successfully!', 'success');
    setIsAddPropertyOpen(false);
    resetPropertyForm();
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

  const handleUpdateProperty = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProperty) {
      updateProperty({ ...selectedProperty, ...propertyForm });
      showToast('Property updated successfully!', 'success');
      setIsEditPropertyOpen(false);
      setSelectedProperty(null);
      resetPropertyForm();
    }
  };

  const handleDeleteProperty = () => {
    if (propertyToDelete) {
      deleteProperty(propertyToDelete.id);
      showToast('Property deleted successfully!', 'success');
      setPropertyToDelete(null);
    }
  };

  const handleAddUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (propertyForUnit) {
      addUnit({ ...unitForm, propertyId: propertyForUnit.id });
      showToast('Unit added successfully!', 'success');
      setIsAddUnitOpen(false);
      setPropertyForUnit(null);
      resetUnitForm();
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

  const handleUpdateUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUnit) {
      updateUnit({ ...selectedUnit, ...unitForm });
      showToast('Unit updated successfully!', 'success');
      setIsEditUnitOpen(false);
      setSelectedUnit(null);
      resetUnitForm();
    }
  };

  const handleDeleteUnit = () => {
    if (unitToDelete) {
      deleteUnit(unitToDelete.id);
      showToast('Unit deleted successfully!', 'success');
      setUnitToDelete(null);
    }
  };

  const handleStatusChange = (unit: Unit, newStatus: Unit['status']) => {
    updateUnit({ ...unit, status: newStatus });
    showToast(`Unit status updated to ${newStatus}`, 'success');
  };

  const totalUnits = units.length;
  const occupiedUnits = units.filter(u => u.status === 'occupied').length;
  const totalMonthlyRent = units.reduce((sum, u) => sum + u.monthlyRent, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Properties</h1>
          <p className="text-slate-500 mt-1 text-sm sm:text-base">Manage your rental properties and units</p>
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
            <Building2 className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{properties.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Units</CardTitle>
            <DoorOpen className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUnits}</div>
            <p className="text-xs text-slate-500">Across all properties</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Occupied Units</CardTitle>
            <Badge variant="success" className="h-2 w-2 p-0" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{occupiedUnits}</div>
            <p className="text-xs text-slate-500">{((occupiedUnits / totalUnits) * 100).toFixed(0)}% occupancy</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Potential Rent</CardTitle>
            <DollarSign className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalMonthlyRent)}</div>
            <p className="text-xs text-slate-500">Per month</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search properties..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Properties List */}
      <div className="space-y-6">
        {filteredProperties.map(property => {
          const propertyUnits = getPropertyUnits(property.id);
          const occupiedCount = propertyUnits.filter(u => u.status === 'occupied').length;
          
          return (
            <Card key={property.id} className="overflow-hidden">
              <div className="h-24 sm:h-32 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-between px-4 sm:px-6 relative">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  <Building2 className="h-8 w-8 sm:h-12 sm:w-12 text-white/50 flex-shrink-0" />
                  <div className="text-white min-w-0">
                    <h3 className="text-lg sm:text-xl font-bold truncate">{property.name}</h3>
                    <p className="text-white/80 text-xs sm:text-sm truncate">{property.address}, {property.city}</p>
                  </div>
                </div>
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
              
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2 text-slate-700">
                    <DoorOpen className="h-5 w-5" />
                    Units ({propertyUnits.length})
                  </h3>
                  <div className="text-sm text-slate-500">
                    <span className="text-emerald-600 font-semibold">{occupiedCount} occupied</span>
                    <span className="mx-2">•</span>
                    <span>{propertyUnits.length - occupiedCount} vacant</span>
                  </div>
                </div>
                
                <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {propertyUnits.map(unit => {
                    const tenant = getUnitTenant(unit.id);
                    return (
                      <div 
                        key={unit.id} 
                        className="border border-slate-200 rounded-xl p-4 hover:shadow-lg transition-all bg-white group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Home className="h-4 w-4 text-slate-400" />
                            <span className="font-semibold text-slate-800">Unit {unit.unitNumber}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant={statusColors[unit.status]} className="text-xs">
                              {unit.status}
                            </Badge>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                              <button
                                onClick={() => handleEditUnit(unit)}
                                className="p-1 hover:bg-slate-100 rounded"
                              >
                                <Edit2 className="h-3 w-3 text-slate-500" />
                              </button>
                              <button
                                onClick={() => setUnitToDelete(unit)}
                                className="p-1 hover:bg-red-50 rounded"
                              >
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </button>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 text-center mb-3">
                          <div className="bg-slate-50 rounded-lg p-2">
                            <Bed className="h-3 w-3 mx-auto mb-1 text-slate-400" />
                            <p className="text-xs font-medium text-slate-700">{unit.bedrooms}</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg p-2">
                            <Bath className="h-3 w-3 mx-auto mb-1 text-slate-400" />
                            <p className="text-xs font-medium text-slate-700">{unit.bathrooms}</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg p-2">
                            <Square className="h-3 w-3 mx-auto mb-1 text-slate-400" />
                            <p className="text-xs font-medium text-slate-700">{unit.squareFeet}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <div>
                            <p className="text-xs text-slate-500">Rent</p>
                            <p className="font-semibold text-emerald-600">{formatCurrency(unit.monthlyRent)}</p>
                          </div>
                          <div className="text-right">
                            {tenant ? (
                              <div className="flex items-center gap-1 text-xs text-slate-600">
                                <Users className="h-3 w-3" />
                                <span>{tenant.firstName} {tenant.lastName[0]}.</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">Vacant</span>
                            )}
                          </div>
                        </div>
                        
                        {/* Quick Status Change */}
                        <div className="mt-3 pt-2 border-t border-slate-100 flex gap-1">
                          {(['vacant', 'occupied', 'maintenance'] as const).map(status => (
                            <button
                              key={status}
                              onClick={() => handleStatusChange(unit, status)}
                              className={`flex-1 py-1 px-2 text-xs rounded-lg capitalize transition-colors ${
                                unit.status === status
                                  ? 'bg-blue-100 text-blue-700 font-medium'
                                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                              }`}
                            >
                              {unit.status === status && <Check className="h-3 w-3 inline mr-1" />}
                              {status}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add Property Modal */}
      <Modal isOpen={isAddPropertyOpen} onClose={() => setIsAddPropertyOpen(false)} title="Add New Property">
        <form onSubmit={handleAddProperty} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Property Name *</label>
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={propertyForm.name} onChange={(e) => setPropertyForm({...propertyForm, name: e.target.value})} placeholder="e.g., Sunset Apartments" />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Address *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.address} onChange={(e) => setPropertyForm({...propertyForm, address: e.target.value})} placeholder="Street address" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.city} onChange={(e) => setPropertyForm({...propertyForm, city: e.target.value})} placeholder="City" />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">State *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.state} onChange={(e) => setPropertyForm({...propertyForm, state: e.target.value})} placeholder="CA" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ZIP Code *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.zipCode} onChange={(e) => setPropertyForm({...propertyForm, zipCode: e.target.value})} placeholder="90001" />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Property Type *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
            <textarea className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" rows={3}
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
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={propertyForm.name} onChange={(e) => setPropertyForm({...propertyForm, name: e.target.value})} />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Address *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.address} onChange={(e) => setPropertyForm({...propertyForm, address: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.city} onChange={(e) => setPropertyForm({...propertyForm, city: e.target.value})} />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">State *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.state} onChange={(e) => setPropertyForm({...propertyForm, state: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ZIP Code *</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={propertyForm.zipCode} onChange={(e) => setPropertyForm({...propertyForm, zipCode: e.target.value})} />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Property Type *</label>
            <select required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
            <textarea className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" rows={3}
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
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={unitForm.unitNumber} onChange={(e) => setUnitForm({...unitForm, unitNumber: e.target.value})} placeholder="e.g., 101, A, 2B" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bedrooms *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.bedrooms} onChange={(e) => setUnitForm({...unitForm, bedrooms: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bathrooms *</label>
              <input type="number" required min={0} step={0.5} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.bathrooms} onChange={(e) => setUnitForm({...unitForm, bathrooms: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Square Feet *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.squareFeet} onChange={(e) => setUnitForm({...unitForm, squareFeet: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Monthly Rent *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.monthlyRent} onChange={(e) => setUnitForm({...unitForm, monthlyRent: parseInt(e.target.value)})} />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" rows={2}
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
            <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={unitForm.unitNumber} onChange={(e) => setUnitForm({...unitForm, unitNumber: e.target.value})} />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bedrooms *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.bedrooms} onChange={(e) => setUnitForm({...unitForm, bedrooms: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bathrooms *</label>
              <input type="number" required min={0} step={0.5} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.bathrooms} onChange={(e) => setUnitForm({...unitForm, bathrooms: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Square Feet *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.squareFeet} onChange={(e) => setUnitForm({...unitForm, squareFeet: parseInt(e.target.value)})} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Monthly Rent *</label>
              <input type="number" required min={0} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                value={unitForm.monthlyRent} onChange={(e) => setUnitForm({...unitForm, monthlyRent: parseInt(e.target.value)})} />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              value={unitForm.status} onChange={(e) => setUnitForm({...unitForm, status: e.target.value as Unit['status']})}>
              <option value="vacant">Vacant</option>
              <option value="occupied">Occupied</option>
              <option value="maintenance">Maintenance</option>
            </select>
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
        message={`Are you sure you want to delete Unit ${unitToDelete?.unitNumber}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
