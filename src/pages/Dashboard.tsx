import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, TrendingUp, 
  TrendingDown, AlertCircle, Wallet, Building2, Percent, ArrowRight, DoorOpen, Home
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, getMonthName } from '../lib/utils';
import { useApp } from '../context/AppContext';
import type { DashboardStats } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

// Stat Card Component
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  gradient: string;
  onClick?: () => void;
  trend?: { value: string; positive: boolean };
}

function StatCard({ title, value, subtitle, icon, gradient, onClick, trend }: StatCardProps) {
  return (
    <Card 
      className="overflow-hidden border-0 shadow-md cursor-pointer transform transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
      onClick={onClick}
    >
      <div className="p-4 sm:p-6 relative overflow-hidden bg-white">
        {/* Subtle top accent bar */}
        <div className={`absolute top-0 left-0 right-0 h-1 ${gradient}`} />
        
        <div className="flex items-start justify-between mb-3 sm:mb-4">
          <div className={`p-2 sm:p-3 rounded-xl ${gradient} bg-opacity-10`}>
            <div className="text-white">
              {icon}
            </div>
          </div>
          {trend && (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
              trend.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </div>
          )}
        </div>
        
        <div>
          <p className="text-slate-500 text-xs sm:text-sm font-medium mb-1">{title}</p>
          <h3 className="text-lg sm:text-2xl font-bold text-slate-800 mb-1">{value}</h3>
          {subtitle && <p className="text-slate-400 text-xs sm:text-sm">{subtitle}</p>}
        </div>
      </div>
    </Card>
  );
}

// Clickable Card Component
interface ClickableCardProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

function ClickableCard({ children, onClick, className = '' }: ClickableCardProps) {
  return (
    <Card 
      className={`shadow-lg cursor-pointer transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${className}`}
      onClick={onClick}
    >
      {children}
    </Card>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { properties, units, tenants, rentPayments, expenses, isLoading, error } = useApp();

  const stats: DashboardStats = useMemo(() => {
    const totalProperties = properties.length;
    const totalUnits = units.length;
    const occupiedUnits = units.filter(u => u.status === 'occupied').length;
    const totalTenants = tenants.filter(t => t.status === 'active').length;
    
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    // Calculate monthly income from paid rent payments (not the separate incomes array)
    const monthlyIncome = rentPayments
      .filter(r => r.status === 'paid' && r.month === currentMonth && r.year === currentYear)
      .reduce((sum, r) => sum + r.amount, 0);
    
    const monthlyExpenses = expenses
      .filter(e => {
        const date = new Date(e.date);
        return date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear;
      })
      .reduce((sum, e) => sum + e.amount, 0);
    
    const totalOwed = rentPayments
      .filter(r => r.status === 'overdue' || r.status === 'pending')
      .reduce((sum, r) => sum + r.amount, 0);

    // Calculate projected yearly income from active tenants' monthly rent
    const projectedYearlyIncome = tenants
      .filter(t => t.status === 'active')
      .reduce((sum, t) => sum + (t.monthlyRent * 12), 0);
    
    return {
      totalProperties,
      totalUnits,
      occupiedUnits,
      totalTenants,
      monthlyIncome,
      monthlyExpenses,
      netIncome: monthlyIncome - monthlyExpenses,
      totalOwed,
      occupancyRate: totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0,
      projectedYearlyIncome,
    };
  }, [properties, units, tenants, expenses, rentPayments]);

  const monthlyData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return months.map(month => {
      // Calculate income from paid rent payments for this month
      const monthIncome = rentPayments
        .filter(r => r.status === 'paid' && r.month === month && r.year === currentYear)
        .reduce((sum, r) => sum + r.amount, 0);
      
      const monthExpenses = expenses
        .filter(e => {
          const date = new Date(e.date);
          return date.getMonth() + 1 === month && date.getFullYear() === currentYear;
        })
        .reduce((sum, e) => sum + e.amount, 0);
      
      return {
        name: getMonthName(month),
        income: monthIncome,
        expenses: monthExpenses,
        net: monthIncome - monthExpenses,
      };
    });
  }, [rentPayments, expenses]);

  const expenseByCategory = useMemo(() => {
    const categories: Record<string, number> = {};
    expenses.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const recentActivity = useMemo(() => {
    const activities = [
      ...rentPayments
        .filter(r => r.paidDate)
        .map(r => ({
          type: 'payment' as const,
          date: r.paidDate!,
          description: `Rent payment received`,
          amount: r.amount,
          property: properties.find(p => p.id === r.propertyId)?.name || '',
          tenant: tenants.find(t => t.id === r.tenantId),
        })),
      ...expenses.map(e => ({
        type: 'expense' as const,
        date: e.date,
        description: e.description,
        amount: -e.amount,
        property: properties.find(p => p.id === e.propertyId)?.name || '',
        tenant: null,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);
    
    return activities;
  }, [rentPayments, expenses, properties, tenants]);

  const overduePayments = useMemo(() => {
    return rentPayments
      .filter(r => r.status === 'overdue')
      .map(r => ({
        ...r,
        tenant: tenants.find(t => t.id === r.tenantId),
        property: properties.find(p => p.id === r.propertyId),
      }));
  }, [rentPayments, tenants, properties]);

  const vacantUnits = useMemo(() => {
    return units.filter(u => u.status === 'vacant').slice(0, 5);
  }, [units]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Error loading data: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500 mt-1 text-sm sm:text-base">
            Welcome back! Here's what's happening with your properties.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          Last updated: {formatDate(new Date().toISOString())}
        </div>
      </div>

      {/* Stats Grid - All Clickable */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Properties"
          value={stats.totalProperties}
          subtitle={`${stats.totalUnits} total units`}
          icon={<Building2 className="h-6 w-6" />}
          gradient="bg-gradient-to-br from-blue-500 to-blue-600"
          trend={{ value: "12%", positive: true }}
          onClick={() => navigate('/properties')}
        />

        <StatCard
          title="Occupancy Rate"
          value={`${stats.occupancyRate.toFixed(0)}%`}
          subtitle={`${stats.occupiedUnits} of ${stats.totalUnits} units occupied`}
          icon={<Percent className="h-6 w-6" />}
          gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
          trend={{ value: "5%", positive: true }}
          onClick={() => navigate('/properties')}
        />

        <StatCard
          title="Active Tenants"
          value={stats.totalTenants}
          subtitle="Across all properties"
          icon={<Users className="h-6 w-6" />}
          gradient="bg-gradient-to-br from-violet-500 to-violet-600"
          onClick={() => navigate('/tenants')}
        />

        <StatCard
          title="Projected Yearly"
          value={formatCurrency(stats.projectedYearlyIncome || 0)}
          subtitle="From active tenants"
          icon={<TrendingUp className="h-6 w-6" />}
          gradient="bg-gradient-to-br from-cyan-500 to-blue-500"
          onClick={() => navigate('/rents')}
        />
      </div>

      {/* Alerts - Clickable */}
      {stats.totalOwed > 0 && (
        <div 
          className="bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 rounded-xl p-5 flex items-start gap-4 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/rents')}
        >
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-red-900">Outstanding Payments</h3>
            <p className="text-red-700 mt-1">
              You have {formatCurrency(stats.totalOwed)} in overdue or pending rent payments.
            </p>
          </div>
          <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors flex items-center gap-2">
            View Details
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Charts Row - Clickable */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              Income vs Expenses
              <ArrowRight className="h-4 w-4 text-slate-400 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#64748b" fontSize={12} />
                <Tooltip 
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.2)' }}
                />
                <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </ClickableCard>

        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Wallet className="h-5 w-5 text-indigo-600" />
              </div>
              Net Income Trend
              <ArrowRight className="h-4 w-4 text-slate-400 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#64748b" fontSize={12} />
                <Tooltip 
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.2)' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="net" 
                  stroke="#6366f1" 
                  strokeWidth={3}
                  dot={{ fill: '#6366f1', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </ClickableCard>
      </div>

      {/* Bottom Row */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
        {/* Expenses by Category - Clickable */}
        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-amber-100 rounded-lg">
                <TrendingDown className="h-5 w-5 text-amber-600" />
              </div>
              Expenses by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={expenseByCategory}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {expenseByCategory.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-2">
              {expenseByCategory.slice(0, 4).map((cat, idx) => (
                <div key={cat.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <span className="capitalize text-slate-600">{cat.name}</span>
                  </div>
                  <span className="font-semibold text-slate-800">{formatCurrency(cat.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </ClickableCard>

        {/* Recent Activity - Clickable items */}
        <Card className="md:col-span-2 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.slice(0, 6).map((activity, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => activity.type === 'payment' ? navigate('/rents') : navigate('/finances')}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${
                      activity.type === 'payment' 
                        ? 'bg-emerald-100 text-emerald-600' 
                        : 'bg-red-100 text-red-600'
                    }`}>
                      {activity.type === 'payment' ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-slate-800">{activity.description}</p>
                      <p className="text-sm text-slate-500">{activity.property}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${
                      activity.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {activity.amount > 0 ? '+' : ''}{formatCurrency(activity.amount)}
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(activity.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vacant Units Quick View */}
      {vacantUnits.length > 0 && (
        <ClickableCard onClick={() => navigate('/properties')} className="border-dashed border-2 border-slate-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-600">
              <div className="p-2 bg-amber-100 rounded-lg">
                <DoorOpen className="h-5 w-5 text-amber-600" />
              </div>
              Vacant Units ({vacantUnits.length})
              <ArrowRight className="h-4 w-4 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {vacantUnits.map(unit => {
                const property = properties.find(p => p.id === unit.propertyId);
                return (
                  <div 
                    key={unit.id} 
                    className="flex-shrink-0 p-4 bg-slate-50 rounded-xl min-w-[200px] cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/properties');
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Home className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold text-slate-700">Unit {unit.unitNumber}</span>
                    </div>
                    <p className="text-sm text-slate-500 mb-1">{property?.name}</p>
                    <p className="text-lg font-bold text-emerald-600">{formatCurrency(unit.monthlyRent)}<span className="text-sm text-slate-400 font-normal">/mo</span></p>
                    <div className="flex gap-2 mt-2 text-xs text-slate-500">
                      <span>{unit.bedrooms} bd</span>
                      <span>•</span>
                      <span>{unit.bathrooms} ba</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </ClickableCard>
      )}

      {/* Overdue Payments Table - Clickable */}
      {overduePayments.length > 0 && (
        <Card className="shadow-lg border-red-200">
          <CardHeader>
            <CardTitle 
              className="flex items-center gap-2 text-red-700 cursor-pointer hover:text-red-800 transition-colors"
              onClick={() => navigate('/rents')}
            >
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              Overdue Payments ({overduePayments.length})
              <ArrowRight className="h-4 w-4 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Tenant</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Property</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Due Date</th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-700">Amount</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overduePayments.slice(0, 5).map(payment => (
                    <tr 
                      key={payment.id} 
                      className="border-b border-slate-100 last:border-0 hover:bg-red-50/50 cursor-pointer transition-colors"
                      onClick={() => navigate('/rents')}
                    >
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {payment.tenant?.firstName} {payment.tenant?.lastName}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {payment.property?.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {formatDate(payment.dueDate)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800">
                        {formatCurrency(payment.amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant="destructive">Overdue</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
