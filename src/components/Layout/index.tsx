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
  ChevronDown,
  LogOut,
  Shield,
  FileText,
  Upload,
  Settings,
  Wrench,
  ClipboardList,
  ScrollText,
  MessageSquare,
  CalendarDays,
  Search,
  FileSpreadsheet,
  FolderKanban,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { messagesApi, vendorMessagesApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { ProfileModal } from '../ProfileModal';
import { BackToTop } from '../BackToTop';
import { CommandPalette } from '../CommandPalette';

interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  show: boolean;
  badge: number;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  show: boolean;
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

/** Persist which sidebar groups are open so collapsing survives navigation. */
const STORAGE_KEY = 'sidebar-open-groups';
function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveOpenGroups(state: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasModuleAccess, hasPermission } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenGroups);

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [label]: !prev[label] };
      saveOpenGroups(next);
      return next;
    });
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Badge for unread tenant messages.
  const canSeeMessages = hasModuleAccess('tenants');
  useEffect(() => {
    if (!canSeeMessages) return;
    let cancelled = false;
    const load = () =>
      Promise.all([messagesApi.unreadCount(), vendorMessagesApi.unreadCount()])
        .then(([t, v]) => {
          if (!cancelled) setUnreadMessages(t.count + v.count);
        })
        .catch(() => {});
    load();
    const tick = () => {
      if (document.visibilityState === 'visible') load();
    };
    const id = window.setInterval(tick, 15000);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', load);
    };
  }, [canSeeMessages, location.pathname]);

  // Build navigation with groups.
  const navigation: NavEntry[] = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, show: true, badge: 0 },
    { name: 'Properties', path: '/properties', icon: Building2, show: hasModuleAccess('properties'), badge: 0 },
    { name: 'Tenants', path: '/tenants', icon: Users, show: hasModuleAccess('tenants'), badge: 0 },
    { name: 'Messages', path: '/messages', icon: MessageSquare, show: hasModuleAccess('tenants'), badge: unreadMessages },
    { name: 'Announcements', path: '/announcements', icon: Megaphone, show: hasPermission('announcements_send'), badge: 0 },
    { name: 'Rent Management', path: '/rents', icon: DollarSign, show: hasModuleAccess('rents'), badge: 0 },
    { name: 'Maintenance', path: '/maintenance', icon: Wrench, show: hasModuleAccess('properties'), badge: 0 },
    { name: 'Calendar', path: '/calendar', icon: CalendarDays, show: hasModuleAccess('finances'), badge: 0 },
    // Finances group
    {
      label: 'Finances',
      icon: Receipt,
      show: hasModuleAccess('finances'),
      children: [
        { name: 'Expenses & Income', path: '/finances', icon: Receipt, show: hasModuleAccess('finances'), badge: 0 },
        { name: 'Capital Projects', path: '/capital-projects', icon: FolderKanban, show: hasPermission('finances_capital_projects'), badge: 0 },
        { name: 'Reports', path: '/reports', icon: ClipboardList, show: hasModuleAccess('finances'), badge: 0 },
        { name: 'Tax Report', path: '/tax-report', icon: FileText, show: hasModuleAccess('finances'), badge: 0 },
        { name: 'Expense Imports', path: '/expense-imports', icon: FileSpreadsheet, show: hasPermission('finances_import'), badge: 0 },
      ],
    },
    // Administration group
    {
      label: 'Administration',
      icon: Settings,
      show: hasModuleAccess('settings') || hasModuleAccess('users') || hasPermission('activity_view'),
      children: [
        { name: 'Settings', path: '/settings', icon: Settings, show: hasModuleAccess('settings'), badge: 0 },
        { name: 'Users', path: '/users', icon: Shield, show: hasModuleAccess('users'), badge: 0 },
        { name: 'Data Migration', path: '/data-migration', icon: Upload, show: hasModuleAccess('settings'), badge: 0 },
        { name: 'Activity', path: '/activity', icon: ScrollText, show: hasPermission('activity_view'), badge: 0 },
      ],
    },
  ];

  // Auto-expand a group if the current page is inside it.
  useEffect(() => {
    for (const entry of navigation) {
      if (isGroup(entry) && entry.children.some(c => c.show && location.pathname === c.path)) {
        if (!openGroups[entry.label]) {
          setOpenGroups(prev => {
            const next = { ...prev, [entry.label]: true };
            saveOpenGroups(next);
            return next;
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Render a single nav link.
  const renderLink = (item: NavItem, indent = false) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;
    return (
      <Link
        key={item.name}
        to={item.path}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'relative w-full flex items-center gap-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group',
          indent ? 'pl-9 pr-3' : 'px-3',
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
  };

  // Render a collapsible group.
  const renderGroup = (group: NavGroup) => {
    const visibleChildren = group.children.filter(c => c.show);
    if (visibleChildren.length === 0) return null;
    const isOpen = !!openGroups[group.label];
    const hasActivePage = visibleChildren.some(c => location.pathname === c.path);
    const Icon = group.icon;

    return (
      <div key={group.label}>
        <button
          onClick={() => toggleGroup(group.label)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 group',
            hasActivePage
              ? 'text-white font-medium'
              : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white'
          )}
        >
          <Icon className={cn(
            'h-[18px] w-[18px] transition-colors flex-shrink-0',
            hasActivePage ? 'text-[#8fbba8]' : 'text-sidebar-muted group-hover:text-white'
          )} />
          <span className="flex-1 text-left truncate">{group.label}</span>
          <ChevronDown className={cn(
            'h-4 w-4 flex-shrink-0 text-white/40 transition-transform duration-200',
            isOpen && 'rotate-180'
          )} />
        </button>
        {isOpen && (
          <div className="mt-0.5 space-y-0.5">
            {visibleChildren.map(child => renderLink(child, true))}
          </div>
        )}
      </div>
    );
  };

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

        {/* Quick search hint */}
        <div className="mx-3 mt-3 mb-1">
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-muted hover:bg-white/[0.04] transition-colors border border-sidebar-line"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Go to...</span>
            <kbd className="text-[10px] font-mono px-1 py-px rounded border border-sidebar-line">⌘K</kbd>
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-0.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          <p className="px-3 pt-3 pb-2 eyebrow text-sidebar-muted">Main Menu</p>
          {navigation.map(entry => {
            if (!('show' in entry) || !entry.show) return null;
            if (isGroup(entry)) return renderGroup(entry);
            return renderLink(entry);
          })}
        </nav>

        {/* User: one compact row */}
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

      <BackToTop />
      <CommandPalette />
    </div>
  );
}
