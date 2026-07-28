import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, CreditCard, Wrench, MessageSquare, FileText } from 'lucide-react';
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
// Tenants get a native-app shell: a slim top bar plus a fixed bottom tab bar
// with icons, the layout people expect from an installed phone app. Realtors
// and handymen keep the simpler top tab strip.

interface PortalLayoutProps {
  children: React.ReactNode;
}

type IconType = typeof Home;

const TENANT_TABS: { name: string; path: string; Icon: IconType }[] = [
  { name: 'Home', path: '/portal', Icon: Home },
  { name: 'Payments', path: '/portal/payments', Icon: CreditCard },
  { name: 'Repairs', path: '/portal/maintenance', Icon: Wrench },
  { name: 'Messages', path: '/portal/messages', Icon: MessageSquare },
  { name: 'Documents', path: '/portal/documents', Icon: FileText },
];

const REALTOR_TABS = [
  { name: 'Dashboard', path: '/portal' },
  { name: 'My tenants', path: '/portal/tenants' },
  { name: 'Available Units', path: '/portal/available' },
];

const HANDYMAN_TABS = [
  { name: 'Jobs', path: '/portal' },
];

export function PortalLayout({ children }: PortalLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Tenants get push notifications on by default, enabled automatically the
  // first time they interact with the app. There is no toggle to turn it off.
  useAutoEnablePush(user?.roleId === 'tenant');

  const isTenant = user?.roleId === 'tenant';

  // Unread office replies drive the badge on the Messages tab. Refresh on load,
  // on navigation (opening the thread clears it server-side), and on focus, and
  // poll every 15s so it updates without navigating.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!isTenant) return;
    let cancelled = false;
    const load = () =>
      portalApi
        .messagesUnread()
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
  }, [isTenant, location.pathname]);

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  const topTabs =
    user?.roleId === 'realtor' ? REALTOR_TABS : user?.roleId === 'handyman' ? HANDYMAN_TABS : null;

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

        {/* Realtors and handymen keep the top tab strip. */}
        {topTabs && (
          <nav className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
            {topTabs.map((tab) => {
              const isActive = location.pathname === tab.path;
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={cn(
                    'px-3 py-3 text-sm border-b-2 whitespace-nowrap transition-colors',
                    isActive
                      ? 'border-primary text-ink font-medium'
                      : 'border-transparent text-muted hover:text-ink'
                  )}
                >
                  {tab.name}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <main className={cn('max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8', isTenant && 'pb-28')}>
        {children}
      </main>

      {/* Tenant app: fixed bottom tab bar. */}
      {isTenant && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-line"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="max-w-md mx-auto flex items-stretch justify-around px-1">
            {TENANT_TABS.map((tab) => {
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
      )}
    </div>
  );
}
