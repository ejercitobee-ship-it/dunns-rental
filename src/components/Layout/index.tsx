import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import logo from '../../assets/mh-dunn-logo.png';
import {
  LayoutDashboard,
  Building2,
  Users,
  DollarSign,
  Receipt,
  Menu,
  X,
  ChevronRight,
  LogOut,
  Shield,
  FileText,
  Upload,
  Settings,
  Wrench,
  ClipboardList,
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
    { name: 'Maintenance', path: '/maintenance', icon: Wrench, show: hasModuleAccess('properties') },
    { name: 'Finances', path: '/finances', icon: Receipt, show: hasModuleAccess('finances') },
    { name: 'Reports', path: '/reports', icon: ClipboardList, show: hasModuleAccess('finances') },
    { name: 'Tax Report', path: '/tax-report', icon: FileText, show: hasModuleAccess('finances') },
    { name: 'Data Migration', path: '/data-migration', icon: Upload, show: hasModuleAccess('settings') },
    { name: 'Settings', path: '/settings', icon: Settings, show: hasModuleAccess('settings') },
    { name: 'Users', path: '/users', icon: Shield, show: hasModuleAccess('users') },
  ].filter(item => item.show);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-72 bg-sidebar text-white border-r border-sidebar-line transform transition-transform duration-300 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo Section */}
        <div className="flex items-start justify-between gap-2 px-4 py-4 border-b border-sidebar-line">
          <Link to="/" className="block flex-1 min-w-0">
            <div className="bg-white rounded-xl px-4 py-3 ring-1 ring-white/10">
              <img src={logo} alt="MH Dunn Property" className="mx-auto h-auto w-full max-w-[176px]" />
            </div>
          </Link>
          <button
            className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-0.5">
          <p className="px-3 pt-3 pb-2 eyebrow text-sidebar-muted">Main Menu</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.name}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group',
                  isActive
                    ? 'bg-white/[0.07] text-white font-medium'
                    : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white'
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[#8fbba8]" />
                )}
                <Icon className={cn(
                  'h-[18px] w-[18px] transition-colors flex-shrink-0',
                  isActive ? 'text-[#8fbba8]' : 'text-sidebar-muted group-hover:text-white'
                )} />
                <span className="flex-1 text-left truncate">{item.name}</span>
                {isActive && <ChevronRight className="h-4 w-4 flex-shrink-0 text-white/40" />}
              </Link>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-sidebar-line">
          <div className="px-3 py-3 rounded-lg bg-white/[0.04]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary ring-1 ring-white/10 flex items-center justify-center text-[#c9ddd2] text-sm font-medium">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-sidebar-muted truncate">{user?.role.name}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-sidebar-muted hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors"
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
        <header className="lg:hidden h-16 bg-surface/90 backdrop-blur-md border-b border-line flex items-center justify-between px-4 sticky top-0 z-30">
          <Link to="/" className="flex items-center">
            <img src={logo} alt="MH Dunn Property" className="h-10 w-auto" />
          </Link>
          <button
            className="p-2 hover:bg-black/[0.05] rounded-lg transition-colors"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5 text-muted" />
          </button>
        </header>

        {/* Page Content */}
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
