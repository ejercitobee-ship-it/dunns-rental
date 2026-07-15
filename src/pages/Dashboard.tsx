import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, TrendingUp,
  TrendingDown, AlertCircle, Wallet, Building2, Percent, ArrowRight, DoorOpen, Home, CalendarClock
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

const COLORS = ['#24503f', '#2c7a58', '#97671c', '#a23429', '#7e8b83'];
const INCOME_COLOR = '#2c7a58';
const EXPENSE_COLOR = '#b98a5e';
const NET_COLOR = '#24503f';

// Stat Card Component
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  onClick?: () => void;
  trend?: { value: string; positive: boolean };
}

function StatCard({ title, value, subtitle, icon, onClick, trend }: StatCardProps) {
  return (
    <Card
      className="cursor-pointer hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.07)]"
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{title}</span>
          <span className="text-faint [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
        </div>
        <div className="mt-3.5 flex items-end gap-2">
          <span className="font-display text-[27px] leading-none font-medium text-ink tnum">{value}</span>
          {trend && (
            <span className={`mb-1 text-xs font-medium ${trend.positive ? 'text-positive' : 'text-danger'}`}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1.5 text-[13px] text-muted">{subtitle}</p>}
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

  const upcomingRenewals = useMemo(() => {
    const now = new Date();
    return tenants
      .filter(t => t.status === 'active' && t.leaseEnd)
      .map(t => {
        const end = new Date(t.leaseEnd);
        const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return { tenant: t, days, end };
      })
      .filter(r => r.days >= 0 && r.days <= 90)
      .sort((a, b) => a.days - b.days);
  }, [tenants]);

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
        <div className="text-danger">Error loading data: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Dashboard</h1>
          <p className="text-muted mt-1 text-sm">
            An overview of your properties, tenants, and cash flow.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-1.5 h-1.5 bg-positive rounded-full"></span>
          Updated {formatDate(new Date().toISOString())}
        </div>
      </div>

      {/* Stats Grid - All Clickable */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Properties"
          value={stats.totalProperties}
          subtitle={`${stats.totalUnits} total units`}
          icon={<Building2 className="h-6 w-6" />}
          trend={{ value: "12%", positive: true }}
          onClick={() => navigate('/properties')}
        />

        <StatCard
          title="Occupancy Rate"
          value={`${stats.occupancyRate.toFixed(0)}%`}
          subtitle={`${stats.occupiedUnits} of ${stats.totalUnits} units occupied`}
          icon={<Percent className="h-6 w-6" />}
          trend={{ value: "5%", positive: true }}
          onClick={() => navigate('/properties')}
        />

        <StatCard
          title="Active Tenants"
          value={stats.totalTenants}
          subtitle="Across all properties"
          icon={<Users className="h-6 w-6" />}
          onClick={() => navigate('/tenants')}
        />

        <StatCard
          title="Projected Yearly"
          value={formatCurrency(stats.projectedYearlyIncome || 0)}
          subtitle="From active tenants"
          icon={<TrendingUp className="h-6 w-6" />}
          onClick={() => navigate('/rents')}
        />
      </div>

      {/* Alerts - Clickable */}
      {stats.totalOwed > 0 && (
        <div 
          className="bg-danger-soft border border-[#e8cdc8] rounded-xl p-5 flex items-start gap-4 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/rents')}
        >
          <div className="p-2 bg-danger-soft rounded-lg">
            <AlertCircle className="h-5 w-5 text-danger" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-red-900">Outstanding Payments</h3>
            <p className="text-danger mt-1">
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
              <div className="p-2 bg-primary-soft rounded-lg">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              Income vs Expenses
              <ArrowRight className="h-4 w-4 text-faint ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e4dd" vertical={false} />
                <XAxis dataKey="name" stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  cursor={{ fill: 'rgba(27,26,23,0.04)' }}
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e7e4dd', boxShadow: '0 8px 30px -8px rgba(27,26,23,0.18)' }}
                />
                <Bar dataKey="income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expenses" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </ClickableCard>

        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              Net Income Trend
              <ArrowRight className="h-4 w-4 text-faint ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e4dd" vertical={false} />
                <XAxis dataKey="name" stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e7e4dd', boxShadow: '0 8px 30px -8px rgba(27,26,23,0.18)' }}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  stroke={NET_COLOR}
                  strokeWidth={2}
                  dot={{ fill: NET_COLOR, strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
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
              <div className="p-2 bg-primary-soft rounded-lg">
                <TrendingDown className="h-5 w-5 text-primary" />
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
                    <span className="capitalize text-muted">{cat.name}</span>
                  </div>
                  <span className="font-semibold text-ink">{formatCurrency(cat.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </ClickableCard>

        {/* Recent Activity - Clickable items */}
        <Card className="md:col-span-2 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.slice(0, 6).map((activity, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between py-3 border-b border-line last:border-0 cursor-pointer hover:bg-black/[0.03] rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => activity.type === 'payment' ? navigate('/rents') : navigate('/finances')}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${
                      activity.type === 'payment'
                        ? 'bg-positive-soft text-positive'
                        : 'bg-danger-soft text-danger'
                    }`}>
                      {activity.type === 'payment' ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-ink">{activity.description}</p>
                      <p className="text-sm text-muted">{activity.property}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold tnum ${
                      activity.amount > 0 ? 'text-positive' : 'text-danger'
                    }`}>
                      {activity.amount > 0 ? '+' : ''}{formatCurrency(activity.amount)}
                    </p>
                    <p className="text-xs text-faint">{formatDate(activity.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Lease Renewals */}
      {upcomingRenewals.length > 0 && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <CalendarClock className="h-5 w-5 text-primary" />
              </div>
              Upcoming Lease Renewals ({upcomingRenewals.length})
              <ArrowRight
                className="h-4 w-4 text-faint ml-auto cursor-pointer"
                onClick={() => navigate('/tenants')}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upcomingRenewals.slice(0, 6).map(({ tenant, days, end }) => {
                const tone = days <= 30 ? 'destructive' : days <= 60 ? 'warning' : 'secondary';
                return (
                  <div
                    key={tenant.id}
                    className="flex items-center justify-between py-2.5 border-b border-line last:border-0 cursor-pointer hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
                    onClick={() => navigate('/tenants')}
                  >
                    <div>
                      <p className="font-medium text-ink">{tenant.firstName} {tenant.lastName}</p>
                      <p className="text-sm text-muted">Lease ends {formatDate(end.toISOString())}</p>
                    </div>
                    <Badge variant={tone}>
                      {days === 0 ? 'Ends today' : days === 1 ? '1 day left' : `${days} days left`}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vacant Units Quick View */}
      {vacantUnits.length > 0 && (
        <ClickableCard onClick={() => navigate('/properties')} className="border-dashed border-2 border-line-strong">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted">
              <div className="p-2 bg-primary-soft rounded-lg">
                <DoorOpen className="h-5 w-5 text-primary" />
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
                    className="flex-shrink-0 p-4 bg-canvas rounded-xl min-w-[200px] cursor-pointer hover:bg-black/[0.05] transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/properties');
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Home className="h-4 w-4 text-faint" />
                      <span className="font-semibold text-ink">Unit {unit.unitNumber}</span>
                    </div>
                    <p className="text-sm text-muted mb-1">{property?.name}</p>
                    <p className="text-lg font-semibold text-primary tnum">{formatCurrency(unit.monthlyRent)}<span className="text-sm text-faint font-normal">/mo</span></p>
                    <div className="flex gap-2 mt-2 text-xs text-muted">
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
        <Card className="shadow-lg border-[#e8cdc8]">
          <CardHeader>
            <CardTitle 
              className="flex items-center gap-2 text-danger cursor-pointer hover:text-red-800 transition-colors"
              onClick={() => navigate('/rents')}
            >
              <div className="p-2 bg-danger-soft rounded-lg">
                <AlertCircle className="h-5 w-5 text-danger" />
              </div>
              Overdue Payments ({overduePayments.length})
              <ArrowRight className="h-4 w-4 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-3 px-4 font-semibold text-ink">Tenant</th>
                    <th className="text-left py-3 px-4 font-semibold text-ink">Property</th>
                    <th className="text-left py-3 px-4 font-semibold text-ink">Due Date</th>
                    <th className="text-right py-3 px-4 font-semibold text-ink">Amount</th>
                    <th className="text-center py-3 px-4 font-semibold text-ink">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overduePayments.slice(0, 5).map(payment => (
                    <tr 
                      key={payment.id} 
                      className="border-b border-line last:border-0 hover:bg-danger-soft/50 cursor-pointer transition-colors"
                      onClick={() => navigate('/rents')}
                    >
                      <td className="py-3 px-4 font-medium text-ink">
                        {payment.tenant?.firstName} {payment.tenant?.lastName}
                      </td>
                      <td className="py-3 px-4 text-muted">
                        {payment.property?.name}
                      </td>
                      <td className="py-3 px-4 text-muted">
                        {formatDate(payment.dueDate)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-ink">
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
