import { Link, useLocation, useNavigate } from 'react-router-dom';
import logo from '../../assets/mh-dunn-logo.png';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
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
  { name: 'My information', path: '/portal/information' },
  { name: 'Documents', path: '/portal/documents' },
];

const REALTOR_TABS = [
  { name: 'Dashboard', path: '/portal' },
  { name: 'My tenants', path: '/portal/tenants' },
];

export function PortalLayout({ children }: PortalLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  const tabs = user?.roleId === 'realtor' ? REALTOR_TABS : TENANT_TABS;

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
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  );
}
