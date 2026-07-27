import { useEffect, useState } from 'react';
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
  ScrollText,
  MessageSquare,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { messagesApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { ProfileModal } from '../ProfileModal';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasModuleAccess } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Badge for unread tenant messages. Refresh on load, on navigation (opening a
  // thread clears it), and when the window regains focus. Guarded to staff who
  // can see tenants.
  const canSeeMessages = hasModuleAccess('tenants');
  useEffect(() => {
    if (!canSeeMessages) return;
    let cancelled = false;
    const load = () =>
      messagesApi
        .unreadCount()
        .then((r) => {
          if (!cancelled) setUnreadMessages(r.count);
        })
        .catch(() => {});
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [canSeeMessages, location.pathname]);

  // Build navigation based on permissions
  const navigation = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, show: true, badge: 0 },
    { name: 'Properties', path: '/properties', icon: Building2, show: hasModuleAccess('properties'), badge: 0 },
    { name: 'Tenants', path: '/tenants', icon: Users, show: hasModuleAccess('tenants'), badge: 0 },
    { name: 'Messages', path: '/messages', icon: MessageSquare, show: hasModuleAccess('tenants'), badge: unreadMessages },
    { name: 'Rent Management', path: '/rents', icon: DollarSign, show: hasModuleAccess('rents'), badge: 0 },
    { name: 'Maintenance', path: '/maintenance', icon: Wrench, show: hasModuleAccess('properties'), badge: 0 },
    { name: 'Finances', path: '/finances', icon: Receipt, show: hasModuleAccess('finances'), badge: 0 },
    { name: 'Reports', path: '/reports', icon: ClipboardList, show: hasModuleAccess('finances'), badge: 0 },
    { name: 'Tax Report', path: '/tax-report', icon: FileText, show: hasModuleAccess('finances'), badge: 0 },
    { name: 'Data Migration', path: '/data-migration', icon: Upload, show: hasModuleAccess('settings'), badge: 0 },
    { name: 'Settings', path: '/settings', icon: Settings, show: hasModuleAccess('settings'), badge: 0 },
    { name: 'Users', path: '/users', icon: Shield, show: hasModuleAccess('users'), badge: 0 },
    { name: 'Activity', path: '/activity', icon: ScrollText, show: user?.roleId === 'super_admin' || user?.roleId === 'admin', badge: 0 },
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
                {item.badge > 0 && (
                  <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[#8fbba8] text-sidebar text-xs font-semibold flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
                {isActive && <ChevronRight className="h-4 w-4 flex-shrink-0 text-white/40" />}
              </Link>
            );
          })}
        </nav>

        {/* User: one compact row — click to open your profile, plus a sign-out icon. */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5 border-t border-sidebar-line">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setProfileOpen(true)}
              title="Your profile"
              className="flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <Avatar
                photoUrl={user?.photoUrl}
                initials={`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}
                className="w-8 h-8 flex-shrink-0"
                initialsClassName="text-xs"
              />
              <span className="min-w-0 text-left">
                <span className="block text-sm font-medium text-white truncate leading-tight">{user?.firstName} {user?.lastName}</span>
                <span className="block text-[11px] text-sidebar-muted truncate leading-tight">{user?.role.name}</span>
              </span>
            </button>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="p-2 rounded-lg text-sidebar-muted hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

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
