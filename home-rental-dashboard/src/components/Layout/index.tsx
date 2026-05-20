import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Users,
  DollarSign,
  Receipt,
  Menu,
  X,
  Home,
  ChevronRight,
  LogOut,
  Shield,
  FileText,
  Upload,
  Settings,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasModuleAccess } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Build navigation based on permissions
  const navigation = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, show: true },
    { name: 'Properties', path: '/properties', icon: Building2, show: hasModuleAccess('properties') },
    { name: 'Tenants', path: '/tenants', icon: Users, show: hasModuleAccess('tenants') },
    { name: 'Rent Management', path: '/rents', icon: DollarSign, show: hasModuleAccess('rents') },
    { name: 'Finances', path: '/finances', icon: Receipt, show: hasModuleAccess('finances') },
    { name: 'Tax Report', path: '/tax-report', icon: FileText, show: hasModuleAccess('finances') },
    { name: 'Data Migration', path: '/data-migration', icon: Upload, show: hasModuleAccess('settings') },
    { name: 'Settings', path: '/settings', icon: Settings, show: hasModuleAccess('settings') },
    { name: 'Team', path: '/users', icon: Shield, show: hasModuleAccess('users') },
  ].filter(item => item.show);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-72 bg-slate-900 text-white shadow-2xl transform transition-transform duration-300 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo Section */}
        <div className="flex items-center justify-between h-20 px-6 border-b border-slate-800">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Home className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-xl tracking-tight">DUNN's Rental</span>
              <p className="text-xs text-slate-400">Property Management</p>
            </div>
          </Link>
          <button
            className="lg:hidden p-2 hover:bg-slate-800 rounded-lg transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          <p className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Main Menu
          </p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.name}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon className={cn(
                  "h-5 w-5 transition-colors",
                  isActive ? "text-white" : "text-slate-500 group-hover:text-white"
                )} />
                <span className="flex-1 text-left">{item.name}</span>
                {isActive && <ChevronRight className="h-4 w-4" />}
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800 bg-slate-900/50">
          <div className="px-4 py-3 rounded-xl bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white font-semibold">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-slate-400 truncate">{user?.role.name}</p>
              </div>
            </div>
            
            <button
              onClick={handleLogout}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:ml-72 min-h-screen">
        {/* Mobile header */}
        <header className="lg:hidden h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 sticky top-0 z-30">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Home className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg text-slate-800">DUNN's Rental</span>
          </Link>
          <button
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5 text-slate-600" />
          </button>
        </header>

        {/* Page Content */}
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
