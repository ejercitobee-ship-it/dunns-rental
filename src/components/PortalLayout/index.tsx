import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, CreditCard, Wrench, MessageSquare, FileText, LayoutDashboard, Users, Building2, Smartphone, X } from 'lucide-react';
import logo from '../../assets/mh-dunn-logo.png';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { useAutoEnablePush } from '../../lib/useAutoPush';
import { portalApi } from '../../lib/api';
import { cn } from '../../lib/utils';

// The portal shell for tenants and realtors. This is a separate world from
// the management app: it does not import Layout or AppContext, so a portal
// user's screen never wires up management data or navigation.
//
// Every portal role gets the same native-app shell: a slim top bar plus a fixed
// bottom tab bar with icons, the layout people expect from an installed phone
// app. Only the tab set changes by role.

interface PortalLayoutProps {
  children: React.ReactNode;
}

type IconType = typeof Home;
type Tab = { name: string; path: string; Icon: IconType };

const TENANT_TABS: Tab[] = [
  { name: 'Home', path: '/portal', Icon: Home },
  { name: 'Payments', path: '/portal/payments', Icon: CreditCard },
  { name: 'Repairs', path: '/portal/maintenance', Icon: Wrench },
  { name: 'Messages', path: '/portal/messages', Icon: MessageSquare },
  { name: 'Documents', path: '/portal/documents', Icon: FileText },
];

const REALTOR_TABS: Tab[] = [
  { name: 'Dashboard', path: '/portal', Icon: LayoutDashboard },
  { name: 'Tenants', path: '/portal/tenants', Icon: Users },
  { name: 'Available', path: '/portal/available', Icon: Building2 },
];

const HANDYMAN_TABS: Tab[] = [
  { name: 'Jobs', path: '/portal', Icon: Wrench },
  { name: 'Messages', path: '/portal/messages', Icon: MessageSquare },
];

export function PortalLayout({ children }: PortalLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Tenants get push notifications on by default, enabled automatically the
  // first time they interact with the app. There is no toggle to turn it off.
  useAutoEnablePush(user?.roleId === 'tenant');

  const isTenant = user?.roleId === 'tenant';
  const isHandyman = user?.roleId === 'handyman';

  // Unread office replies drive the badge on the Messages tab (tenant thread for
  // a tenant, vendor thread for a handyman). Refresh on load, on navigation
  // (opening the thread clears it server-side), on focus, and every 15s.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!isTenant && !isHandyman) return;
    let cancelled = false;
    const load = () =>
      (isHandyman ? portalApi.vendorMessagesUnread() : portalApi.messagesUnread())
        .then((r) => {
          if (!cancelled) setUnread(r.count);
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
  }, [isTenant, isHandyman, location.pathname]);

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  const tabs =
    user?.roleId === 'realtor' ? REALTOR_TABS : user?.roleId === 'handyman' ? HANDYMAN_TABS : TENANT_TABS;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface/80 backdrop-blur-md border-b border-line sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link to="/portal" className="flex items-center">
            <img src={logo} alt="MH Dunn Property" className="h-9 w-auto" />
          </Link>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-ink leading-tight">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="eyebrow leading-tight">{user?.role.name}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28">
        <InstallPrompt />
        {children}
      </main>

      {/* Native app: fixed bottom tab bar for every portal role. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="max-w-md mx-auto flex items-stretch justify-around px-1">
            {tabs.map((tab) => {
              const isActive = location.pathname === tab.path;
              const Icon = tab.Icon;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={cn(
                    'relative flex flex-col items-center gap-1 py-2.5 px-2 flex-1 transition-colors',
                    isActive ? 'text-primary' : 'text-faint hover:text-muted'
                  )}
                >
                  <span className="relative">
                    <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.2 : 1.8} />
                    {tab.path === '/portal/messages' && unread > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-surface">
                        {unread}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-semibold tracking-wide">{tab.name}</span>
                </Link>
              );
            })}
        </div>
      </nav>
    </div>
  );
}

/**
 * A one-time, dismissible nudge to add the app to the home screen. Hidden when
 * the app is already running installed (standalone) or after the user dismisses
 * it. Links to the full step-by-step guide.
 */
function InstallPrompt() {
  // Decide once, synchronously, on mount: hidden when already installed
  // (standalone) or previously dismissed.
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    return !standalone && localStorage.getItem('installPromptDismissed') !== '1';
  });
  if (!show) return null;
  return (
    <div className="mb-5 rounded-2xl border border-primary/25 bg-primary-soft/50 p-4 flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-primary text-white grid place-items-center flex-shrink-0">
        <Smartphone className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Add MH Dunn to your home screen</p>
        <p className="text-xs text-muted">
          One tap to open, and get reminders as notifications.{' '}
          <Link to="/portal/install" className="text-primary font-medium underline">Show me how</Link>
        </p>
      </div>
      <button
        onClick={() => { localStorage.setItem('installPromptDismissed', '1'); setShow(false); }}
        className="p-1.5 text-faint hover:text-ink flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
