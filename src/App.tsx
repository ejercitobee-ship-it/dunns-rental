import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { Home } from './pages/Home';
import { Properties } from './pages/Properties';
import { Tenants } from './pages/Tenants';
import { TenantDetail } from './pages/TenantDetail';
import { Rents } from './pages/Rents';
import { Maintenance } from './pages/Maintenance';
import { Reports } from './pages/Reports';
import { Expenses } from './pages/Expenses';
import { TaxReport } from './pages/TaxReport';
import { DataMigration } from './pages/DataMigration';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { PortalLayout } from './components/PortalLayout';
import { TenantHome } from './pages/portal/TenantHome';
import { TenantPayments } from './pages/portal/TenantPayments';
import { TenantDocuments } from './pages/portal/TenantDocuments';
import { RealtorTenants } from './pages/portal/RealtorTenants';
import { RealtorTenantDetail } from './pages/portal/RealtorTenantDetail';
import { RealtorDashboard } from './pages/portal/RealtorDashboard';
import { RealtorAvailableUnits } from './pages/portal/RealtorAvailableUnits';
import { isPortalRole } from './types';

// Protected Route component
function ProtectedRoute({ children, requiredPermission }: { children: React.ReactNode; requiredPermission?: string }) {
  const { isAuthenticated, hasPermission, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A portal role (tenant, realtor) has no management permissions on the
  // server, so a deep link into a management route (e.g. /rents) would show
  // them nothing but errors. Bounce them to their own portal instead of the
  // dashboard.
  if (isPortalRole(user?.roleId)) {
    return <Navigate to="/portal" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// Public Route component (redirects to dashboard if authenticated)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/**
 * The portal wall on the client. The real wall is server side: tenant and
 * realtor roles hold no permissions, so requirePermission refuses them on
 * every management endpoint. This only stops them loading a page that would
 * show them nothing but errors.
 */
function PortalRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isPortalRole(user?.roleId)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// The portal landing: a tenant sees their home, a realtor sees their tenant
// list. Both pages are placeholders until Tasks 10 and 11 build them out.
function PortalIndex() {
  const { user } = useAuth();
  if (user?.roleId === 'realtor') {
    return <RealtorDashboard />;
  }
  return <TenantHome />;
}

// The site root. A logged-out visitor sees the public homepage; a logged-in
// user sees their dashboard, exactly as before. Keeping the dashboard at "/"
// means no existing link, nav item, or redirect has to change.
function RootRoute() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Home />;
  }

  // A portal user never sees the management dashboard.
  if (isPortalRole(user?.roleId)) {
    return <Navigate to="/portal" replace />;
  }

  return (
    <Layout>
      <Dashboard />
    </Layout>
  );
}

function AppRoutes() {
  const { isLoading } = useAuth();

  // While the initial session check is in flight, show a loader instead of
  // routing. Otherwise a hard refresh or deep link briefly reads as
  // "logged out" and bounces the user to /login and then to the dashboard.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />

      <Route path="/register" element={
        <PublicRoute>
          <Register />
        </PublicRoute>
      } />

      <Route path="/forgot-password" element={
        <PublicRoute>
          <ForgotPassword />
        </PublicRoute>
      } />

      {/* Reachable from an emailed link, so it must work even if a stale
          session cookie is present. */}
      <Route path="/reset-password" element={<ResetPassword />} />
      
      <Route path="/" element={<RootRoute />} />

      <Route path="/portal" element={
        <PortalRoute>
          <PortalLayout><PortalIndex /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/payments" element={
        <PortalRoute>
          <PortalLayout><TenantPayments /></PortalLayout>
        </PortalRoute>
      } />

      {/* Retired: the tenant's profile now lives on the Home page. Keep the
          path so old bookmarks land somewhere sensible. */}
      <Route path="/portal/information" element={<Navigate to="/portal" replace />} />

      <Route path="/portal/documents" element={
        <PortalRoute>
          <PortalLayout><TenantDocuments /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/tenants" element={
        <PortalRoute>
          <PortalLayout><RealtorTenants /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/tenants/:id" element={
        <PortalRoute>
          <PortalLayout><RealtorTenantDetail /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/available" element={
        <PortalRoute>
          <PortalLayout><RealtorAvailableUnits /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/properties" element={
        <ProtectedRoute requiredPermission="properties_view">
          <Layout><Properties /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/tenants" element={
        <ProtectedRoute requiredPermission="tenants_view">
          <Layout><Tenants /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/tenants/:id" element={
        <ProtectedRoute requiredPermission="tenants_view">
          <Layout><TenantDetail /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/rents" element={
        <ProtectedRoute requiredPermission="rents_view">
          <Layout><Rents /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/maintenance" element={
        <ProtectedRoute requiredPermission="properties_view">
          <Layout><Maintenance /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/finances" element={
        <ProtectedRoute requiredPermission="finances_view">
          <Layout><Expenses /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/reports" element={
        <ProtectedRoute requiredPermission="finances_view">
          <Layout><Reports /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/tax-report" element={
        <ProtectedRoute requiredPermission="finances_view">
          <Layout><TaxReport /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/data-migration" element={
        <ProtectedRoute requiredPermission="settings_edit">
          <Layout><DataMigration /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/settings" element={
        <ProtectedRoute requiredPermission="settings_view">
          <Layout><Settings /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/users" element={
        <ProtectedRoute requiredPermission="users_view">
          <Layout><Users /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
