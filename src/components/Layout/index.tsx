import { useEffect, useRef, useState } from 'react';
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
  ChevronLeft,
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
  Bot,
  ListChecks,
  Bell,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { messagesApi, vendorMessagesApi, realtorMessagesApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useScrolled } from '../../lib/useScrolled';
import { Avatar } from '../ui/Avatar';
import { ProfileModal } from '../ProfileModal';
import { BackToTop } from '../BackToTop';
import { CommandPalette } from '../CommandPalette';
import { PageTransition } from '../PageTransition';
import { NotificationBell } from '../NotificationBell';

// Three-tier navigation model:
//   Section  → a labeled, optionally collapsible group (Workspace, Property
//              Management, Financial Management, Communication, Administration)
//   SubGroup → a nested collapsible submenu inside a section (Finances,
//              Email & Reminders)
//   NavItem  → a single route link
interface NavItem {
  kind: 'item';
  name: string;
  path: string;
  icon: LucideIcon;
  show: boolean;
  badge: number;
}

interface SubGroup {
  kind: 'group';
  label: string;
  icon: LucideIcon;
  show: boolean;
  children: NavItem[];
}

interface Section {
  kind: 'section';
  label: string;
  collapsible: boolean;
  show: boolean;
  children: (NavItem | SubGroup)[];
}

/** Persist which sidebar sections/sub-groups are open so it survives navigation. */
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

function loadCollapsed(): boolean {
  try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
}

function MobileBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => {
      import('../../lib/api').then(({ mgmtNotificationsApi }) =>
        mgmtNotificationsApi.unreadCount().then(r => setCount(r.count)).catch(() => {})
      );
    };
    load();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <button
      onClick={() => navigate('/notifications')}
      className="relative p-2 hover:bg-black/[0.05] rounded-lg transition-colors"
      aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
    >
      <Bell className="h-5 w-5 text-muted" />
      {count > 0 && (
        <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
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
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [flyoutGroup, setFlyoutGroup] = useState<string | null>(null);
  const flyoutTimeout = useRef<number | null>(null);
  const scrolled = useScrolled();

  // On mobile overlay the sidebar always shows labels (expanded).
  // On desktop, labels hide when collapsed.
  const showLabels = !collapsed || sidebarOpen;

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch { /* noop */ }
      if (next) setFlyoutGroup(null);
      return next;
    });
  };

  const showFlyout = (label: string) => {
    if (flyoutTimeout.current) { clearTimeout(flyoutTimeout.current); flyoutTimeout.current = null; }
    setFlyoutGroup(label);
  };
  const hideFlyout = () => {
    flyoutTimeout.current = window.setTimeout(() => setFlyoutGroup(null), 200);
  };

  // Toggle takes the current effective open state so defaults (sections open,
  // sub-groups closed) flip correctly on the first click.
  const toggleGroup = (label: string, current: boolean) => {
    setOpenGroups(prev => {
      const next = { ...prev, [label]: !current };
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
      Promise.all([messagesApi.unreadCount(), vendorMessagesApi.unreadCount(), realtorMessagesApi.unreadCount()])
        .then(([t, v, r]) => {
          if (!cancelled) setUnreadMessages(t.count + v.count + r.count);
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

  // Build the grouped navigation. `show` expressions are the existing
  // permission gates — unchanged — so visibility matches the backend exactly.
  const item = (name: string, path: string, icon: LucideIcon, show: boolean, badge = 0): NavItem =>
    ({ kind: 'item', name, path, icon, show, badge });

  const financesGroup: SubGroup = {
    kind: 'group', label: 'Finances', icon: Receipt, show: false,
    children: [
      item('Expenses & Income', '/finances', Receipt, hasModuleAccess('finances')),
      item('Capital Projects', '/capital-projects', FolderKanban, hasPermission('finances_capital_projects')),
      item('Reports', '/reports', ClipboardList, hasModuleAccess('finances')),
      item('Tax Report', '/tax-report', FileText, hasModuleAccess('finances')),
      item('Expense Imports', '/expense-imports', FileSpreadsheet, hasPermission('finances_import')),
    ],
  };

  const emailGroup: SubGroup = {
    kind: 'group', label: 'Email & Reminders', icon: Mail, show: false,
    children: [
      item('Reminders', '/reminders', Bell, hasPermission('announcements_send')),
      item('Campaigns', '/email/campaigns', Megaphone, hasPermission('announcements_send')),
      item('Email Templates', '/email/templates', Mail, hasPermission('announcements_send')),
    ],
  };

  const sections: Section[] = [
    {
      kind: 'section', label: 'Workspace', collapsible: false, show: false,
      children: [
        item('Dashboard', '/', LayoutDashboard, true),
        item('AI Assistant', '/ai-assistant', Bot, hasPermission('ai_assistant_use')),
      ],
    },
    {
      kind: 'section', label: 'Property Management', collapsible: true, show: false,
      children: [
        item('Properties', '/properties', Building2, hasModuleAccess('properties')),
        item('Tenants', '/tenants', Users, hasModuleAccess('tenants')),
        item('Maintenance', '/maintenance', Wrench, hasModuleAccess('properties')),
        item('Tasks', '/tasks', ListChecks, hasModuleAccess('tasks')),
        item('Calendar', '/calendar', CalendarDays, hasModuleAccess('finances')),
      ],
    },
    {
      kind: 'section', label: 'Financial Management', collapsible: true, show: false,
      children: [
        item('Rent Management', '/rents', DollarSign, hasModuleAccess('rents')),
        financesGroup,
        item('Payment Plans', '/payment-plans', CalendarDays, hasModuleAccess('rents')),
      ],
    },
    {
      kind: 'section', label: 'Communication', collapsible: true, show: false,
      children: [
        item('Messages', '/messages', MessageSquare, hasModuleAccess('tenants'), unreadMessages),
        item('Announcements', '/announcements', Megaphone, hasPermission('announcements_send')),
        emailGroup,
      ],
    },
    {
      kind: 'section', label: 'Administration', collapsible: true, show: false,
      children: [
        item('Settings', '/settings', Settings, hasModuleAccess('settings')),
        item('Users', '/users', Shield, hasModuleAccess('users')),
        item('Data Migration', '/data-migration', Upload, hasModuleAccess('settings')),
        item('Activity Logs', '/activity', ScrollText, hasPermission('activity_view')),
      ],
    },
  ];
  // A sub-group shows if any child shows; a section shows if any child shows.
  for (const section of sections) {
    for (const child of section.children) {
      if (child.kind === 'group') child.show = child.children.some(c => c.show);
    }
    section.show = section.children.some(c => c.show);
  }

  // Auto-expand the section (and any sub-group) that contains the active route.
  useEffect(() => {
    const toOpen: string[] = [];
    for (const section of sections) {
      if (!section.show) continue;
      let sectionActive = false;
      for (const child of section.children) {
        if (child.kind === 'group') {
          if (child.show && child.children.some(c => c.show && c.path === location.pathname)) {
            toOpen.push(child.label);
            sectionActive = true;
          }
        } else if (child.path === location.pathname) {
          sectionActive = true;
        }
      }
      if (sectionActive && section.collapsible) toOpen.push(section.label);
    }
    if (toOpen.length) {
      setOpenGroups(prev => {
        let changed = false;
        const next = { ...prev };
        for (const k of toOpen) if (!next[k]) { next[k] = true; changed = true; }
        if (!changed) return prev;
        saveOpenGroups(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Render a single nav link. `indent` is for sub-group children (2 levels deep).
  const renderLink = (item: NavItem, indent = false) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;
    return (
      <Link
        key={item.name}
        to={item.path}
        onClick={() => { setSidebarOpen(false); setFlyoutGroup(null); }}
        title={showLabels ? undefined : item.name}
        className={cn(
          'relative w-full flex items-center rounded-lg text-sm transition-colors duration-150 group',
          showLabels
            ? cn('gap-3 py-2.5', indent ? 'pl-9 pr-3' : 'px-3')
            : 'justify-center py-2.5 px-0',
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
        {showLabels && <span className="flex-1 text-left truncate">{item.name}</span>}
        {showLabels && item.badge > 0 && (
          <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[#8fbba8] text-sidebar text-xs font-semibold flex items-center justify-center">
            {item.badge}
          </span>
        )}
        {!showLabels && item.badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#8fbba8] text-sidebar text-[10px] font-bold flex items-center justify-center">
            {item.badge}
          </span>
        )}
        {showLabels && isActive && <ChevronRight className="h-4 w-4 flex-shrink-0 text-white/40" />}
      </Link>
    );
  };

  // Render a collapsible sub-group (Finances, Email & Reminders).
  const renderGroup = (group: SubGroup) => {
    const visibleChildren = group.children.filter(c => c.show);
    if (visibleChildren.length === 0) return null;
    const isOpen = !!openGroups[group.label]; // sub-groups default closed
    const hasActivePage = visibleChildren.some(c => location.pathname === c.path);
    const Icon = group.icon;

    // Collapsed mode: icon + hover flyout
    if (!showLabels) {
      return (
        <div
          key={group.label}
          className="relative"
          onMouseEnter={() => showFlyout(group.label)}
          onMouseLeave={hideFlyout}
        >
          <button
            title={group.label}
            className={cn(
              'w-full flex items-center justify-center py-2.5 rounded-lg text-sm transition-colors duration-150 group',
              hasActivePage
                ? 'bg-white/[0.07] text-white font-medium'
                : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white'
            )}
          >
            <Icon className={cn(
              'h-[18px] w-[18px] transition-colors flex-shrink-0',
              hasActivePage ? 'text-[#8fbba8]' : 'text-sidebar-muted group-hover:text-white'
            )} />
          </button>
          {flyoutGroup === group.label && (
            <div
              className="absolute left-full top-0 ml-1.5 bg-sidebar border border-sidebar-line rounded-xl py-1.5 shadow-2xl min-w-[200px] z-[60] flyout-enter"
              onMouseEnter={() => showFlyout(group.label)}
              onMouseLeave={hideFlyout}
            >
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-sidebar-muted font-semibold">{group.label}</p>
              <div className="space-y-0.5 px-1.5">
                {visibleChildren.map(child => {
                  const ChildIcon = child.icon;
                  const childActive = location.pathname === child.path;
                  return (
                    <Link
                      key={child.name}
                      to={child.path}
                      onClick={() => { setSidebarOpen(false); setFlyoutGroup(null); }}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors',
                        childActive
                          ? 'bg-white/[0.07] text-white font-medium'
                          : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white'
                      )}
                    >
                      <ChildIcon className={cn('h-4 w-4 flex-shrink-0', childActive ? 'text-[#8fbba8]' : '')} />
                      <span className="truncate">{child.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Expanded mode: collapsible sub-group
    return (
      <div key={group.label}>
        <button
          onClick={() => toggleGroup(group.label, isOpen)}
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

  const renderChildren = (section: Section) =>
    section.children
      .filter(c => c.show)
      .map(child => (child.kind === 'group' ? renderGroup(child) : renderLink(child)));

  // Render one section. Collapsed mode: a divider + icons (no label). Expanded
  // mode: an uppercase label (a toggle button when collapsible) + children.
  const renderSection = (section: Section, visibleIdx: number) => {
    if (!showLabels) {
      return (
        <div key={section.label}>
          {visibleIdx > 0 && <div className="my-2 border-t border-sidebar-line" />}
          <div className="space-y-0.5">{renderChildren(section)}</div>
        </div>
      );
    }

    if (!section.collapsible) {
      return (
        <div key={section.label} className="space-y-0.5">
          <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/70">
            {section.label}
          </p>
          {renderChildren(section)}
        </div>
      );
    }

    const isOpen = openGroups[section.label] ?? true; // sections default open
    const hasActive = section.children.some(c =>
      c.kind === 'group'
        ? c.children.some(ch => ch.show && ch.path === location.pathname)
        : c.path === location.pathname
    );
    return (
      <div key={section.label} className="space-y-0.5">
        <button
          onClick={() => toggleGroup(section.label, isOpen)}
          className="w-full flex items-center gap-2 px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/70 hover:text-sidebar-muted transition-colors"
        >
          <span className="flex-1 text-left">{section.label}</span>
          <ChevronDown className={cn(
            'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200',
            isOpen ? 'rotate-180' : (hasActive ? 'text-[#8fbba8]' : '')
          )} />
        </button>
        {isOpen && <div className="space-y-0.5">{renderChildren(section)}</div>}
      </div>
    );
  };

  const visibleSections = sections.filter(s => s.show);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Mobile sidebar overlay — always rendered so it can fade in/out */}
      <div
        className={cn(
          'fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-40 lg:hidden transition-opacity duration-200',
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full bg-sidebar text-white border-r border-sidebar-line flex flex-col',
          'transform transition-[transform,width] duration-200 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'w-64', // base width for mobile overlay
          collapsed ? 'lg:w-16' : 'lg:w-64', // desktop width
        )}
      >
        {/* Logo + close/collapse */}
        <div className={cn(
          'flex items-center border-b border-sidebar-line flex-shrink-0',
          showLabels ? 'justify-between gap-2 px-4 py-3' : 'justify-center px-2 py-3',
        )}>
          {showLabels ? (
            <Link to="/" className="flex items-center gap-2.5 min-w-0" onClick={() => setSidebarOpen(false)}>
              <div className="bg-white rounded-lg p-1.5 flex-shrink-0">
                <img src={logo} alt="MH Dunn Property" className="h-7 w-auto" />
              </div>
              <span className="text-sm font-semibold text-white tracking-tight truncate">MH Dunn Property</span>
            </Link>
          ) : (
            <Link to="/" className="block" onClick={() => setSidebarOpen(false)}>
              <div className="bg-white rounded-lg p-1 mx-auto">
                <img src={logo} alt="MH Dunn Property" className="h-6 w-auto" />
              </div>
            </Link>
          )}
          {/* Mobile close (X) */}
          <button
            className="lg:hidden p-1.5 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Quick search — only when expanded */}
        {showLabels && (
          <div className="px-3 pt-3 pb-1 flex-shrink-0">
            <button
              onClick={() => { setSidebarOpen(false); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-sidebar-muted hover:bg-white/[0.04] transition-colors border border-sidebar-line"
            >
              <Search className="h-3 w-3" />
              <span className="flex-1 text-left">Go to...</span>
              <kbd className="text-[10px] font-mono px-1 py-px rounded border border-sidebar-line">⌘K</kbd>
            </button>
          </div>
        )}

        {/* Navigation — flex-1 fills remaining space, scrolls independently */}
        <nav className={cn('flex-1 overflow-y-auto py-2 space-y-1 sidebar-scroll', showLabels ? 'px-3' : 'px-1.5')}>
          {visibleSections.map((section, idx) => renderSection(section, idx))}
        </nav>

        {/* Collapse toggle — desktop only */}
        <div className="hidden lg:block flex-shrink-0 px-2 pb-1">
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs text-sidebar-muted hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            {collapsed
              ? <ChevronRight className="h-4 w-4" />
              : <><ChevronLeft className="h-4 w-4" /><span>Collapse</span></>
            }
          </button>
        </div>

        {/* User footer — flex-shrink-0, always visible */}
        <div className={cn('flex-shrink-0 border-t border-sidebar-line', showLabels ? 'px-3 py-2' : 'px-1.5 py-2')}>
          {showLabels ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setProfileOpen(true)}
                title="Your profile"
                className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
              >
                <Avatar
                  photoUrl={user?.photoUrl}
                  initials={`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}
                  className="w-7 h-7 flex-shrink-0"
                  initialsClassName="text-[10px]"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium text-white truncate leading-tight">{user?.firstName} {user?.lastName}</span>
                  <span className="block text-[10px] text-sidebar-muted truncate leading-tight">{user?.role.name}</span>
                </span>
              </button>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="p-1.5 rounded-lg text-sidebar-muted hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => setProfileOpen(true)}
                title={`${user?.firstName} ${user?.lastName}`}
                className="p-1 rounded-lg hover:bg-white/[0.06] transition-colors"
              >
                <Avatar
                  photoUrl={user?.photoUrl}
                  initials={`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}
                  className="w-7 h-7"
                  initialsClassName="text-[10px]"
                />
              </button>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="p-1 rounded-lg text-sidebar-muted hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      {/* Main content */}
      <main className={cn('min-h-screen transition-[margin-left] duration-200 ease-in-out', collapsed ? 'lg:ml-16' : 'lg:ml-64')}>
        {/* Desktop top bar — hosts the notification bell */}
        <header className={cn('hidden lg:flex h-14 bg-surface/90 backdrop-blur-md items-center justify-end px-6 gap-2 sticky top-0 z-30 border-b border-line sticky-header', scrolled && 'scrolled')}>
          <NotificationBell placement="header" />
        </header>

        {/* Mobile header */}
        <header className={cn('lg:hidden h-16 bg-surface/90 backdrop-blur-md flex items-center justify-between px-4 sticky top-0 z-30 sticky-header', scrolled && 'scrolled')}>
          <Link to="/" className="flex items-center">
            <img src={logo} alt="MH Dunn Property" className="h-10 w-auto" />
          </Link>
          <div className="flex items-center gap-1">
            <MobileBell />
            <button
              className="p-2 hover:bg-black/[0.05] rounded-lg transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5 text-muted" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>

      <BackToTop />
      <CommandPalette />
    </div>
  );
}
