import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import logo from '../../assets/mh-dunn-logo.png';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { useAutoEnablePush } from '../../lib/useAutoPush';
import { portalApi } from '../../lib/api';
import { cn } from '../../lib/utils';

// The portal shell for tenants and realtors. This is a separate world from
// the management app: it does not import Layout or AppContext, so a portal
// user's screen never wires up management data or navigation.

interface PortalLayoutProps {
  children: React.ReactNode;
}

const TENANT_TABS = [
  { name: 'Home', path: '/portal' },
  { name: 'Payments', path: '/portal/payments' },
  { name: 'Maintenance', path: '/portal/maintenance' },
  { name: 'Messages', path: '/portal/messages' },
  { name: 'Documents', path: '/portal/documents' },
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

  // Unread office replies drive the badge on the Messages tab. Refresh on load,
  // on navigation (opening the thread clears it server-side), and on focus.
  const isTenant = user?.roleId === 'tenant';
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
    // Keep the badge live without navigation: poll every 15s while visible, and
    // refresh immediately on focus.
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

  const tabs =
    user?.roleId === 'realtor' ? REALTOR_TABS : user?.roleId === 'handyman' ? HANDYMAN_TABS : TENANT_TABS;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface border-b border-line">
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

        <nav className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={cn(
                  'px-3 py-3 text-sm border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5',
                  isActive
                    ? 'border-primary text-ink font-medium'
                    : 'border-transparent text-muted hover:text-ink'
                )}
              >
                {tab.name}
                {tab.path === '/portal/messages' && unread > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  );
}
