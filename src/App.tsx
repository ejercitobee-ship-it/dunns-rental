import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { PortalLayout } from './components/PortalLayout';
import { ScrollToTop } from './components/ScrollToTop';
import { Login } from './pages/Login';
import { isPortalRole } from './types';

// Route pages are loaded on demand so the first screen (and each tenant's phone)
// only downloads what it needs, not the whole app including the admin charts.
// Named exports, so each import is remapped to a default for React.lazy.
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const Properties = lazy(() => import('./pages/Properties').then(m => ({ default: m.Properties })));
const PropertyProfile = lazy(() => import('./pages/PropertyProfile').then(m => ({ default: m.PropertyProfile })));
const Tenants = lazy(() => import('./pages/Tenants').then(m => ({ default: m.Tenants })));
const TenantDetail = lazy(() => import('./pages/TenantDetail').then(m => ({ default: m.TenantDetail })));
const Rents = lazy(() => import('./pages/Rents').then(m => ({ default: m.Rents })));
const Maintenance = lazy(() => import('./pages/Maintenance').then(m => ({ default: m.Maintenance })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Expenses = lazy(() => import('./pages/Expenses').then(m => ({ default: m.Expenses })));
const TaxReport = lazy(() => import('./pages/TaxReport').then(m => ({ default: m.TaxReport })));
const DataMigration = lazy(() => import('./pages/DataMigration').then(m => ({ default: m.DataMigration })));
const ExpenseImport = lazy(() => import('./pages/ExpenseImport').then(m => ({ default: m.ExpenseImportPage })));
const CapitalProjects = lazy(() => import('./pages/CapitalProjects').then(m => ({ default: m.CapitalProjects })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Users = lazy(() => import('./pages/Users').then(m => ({ default: m.Users })));
const Activity = lazy(() => import('./pages/Activity').then(m => ({ default: m.Activity })));
const Calendar = lazy(() => import('./pages/Calendar').then(m => ({ default: m.Calendar })));
const Messages = lazy(() => import('./pages/Messages').then(m => ({ default: m.Messages })));
const ProspectiveTenantDetail = lazy(() => import('./pages/ProspectiveTenantDetail').then(m => ({ default: m.ProspectiveTenantDetail })));
const SigningPage = lazy(() => import('./pages/SigningPage').then(m => ({ default: m.SigningPage })));
const TenantHome = lazy(() => import('./pages/portal/TenantHome').then(m => ({ default: m.TenantHome })));
const TenantPayments = lazy(() => import('./pages/portal/TenantPayments').then(m => ({ default: m.TenantPayments })));
const TenantMaintenance = lazy(() => import('./pages/portal/TenantMaintenance').then(m => ({ default: m.TenantMaintenance })));
const TenantMessages = lazy(() => import('./pages/portal/TenantMessages').then(m => ({ default: m.TenantMessages })));
const TenantDocuments = lazy(() => import('./pages/portal/TenantDocuments').then(m => ({ default: m.TenantDocuments })));
const HandymanJobs = lazy(() => import('./pages/portal/HandymanJobs').then(m => ({ default: m.HandymanJobs })));
const HandymanMessages = lazy(() => import('./pages/portal/HandymanMessages').then(m => ({ default: m.HandymanMessages })));
const InstallGuide = lazy(() => import('./pages/portal/InstallGuide').then(m => ({ default: m.InstallGuide })));
const RealtorTenants = lazy(() => import('./pages/portal/RealtorTenants').then(m => ({ default: m.RealtorTenants })));
const RealtorTenantDetail = lazy(() => import('./pages/portal/RealtorTenantDetail').then(m => ({ default: m.RealtorTenantDetail })));
const RealtorDashboard = lazy(() => import('./pages/portal/RealtorDashboard').then(m => ({ default: m.RealtorDashboard })));
const RealtorAvailableUnits = lazy(() => import('./pages/portal/RealtorAvailableUnits').then(m => ({ default: m.RealtorAvailableUnits })));
const Announcements = lazy(() => import('./pages/Announcements').then(m => ({ default: m.Announcements })));
const AIAssistant = lazy(() => import('./pages/AIAssistant').then(m => ({ default: m.AIAssistant })));

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
  if (user?.roleId === 'handyman') {
    return <HandymanJobs />;
  }
  return <TenantHome />;
}

// /portal/messages is shared: a handyman sees their vendor thread with the
// office, a tenant sees their own thread.
function PortalMessages() {
  const { user } = useAuth();
  return user?.roleId === 'handyman' ? <HandymanMessages /> : <TenantMessages />;
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

// A calm, on-brand loader shown while a route's chunk (or the initial session
// check) is loading. Uses a slim progress bar at the top of the viewport instead
// of a spinner to feel faster and less intrusive.
function RouteFallback() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="fixed top-0 left-0 right-0 z-[60] h-[3px] bg-primary/20 overflow-hidden">
        <div className="h-full w-1/3 bg-primary rounded-full animate-[shimmer_1.2s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}

function AppRoutes() {
  const { isLoading } = useAuth();

  // While the initial session check is in flight, show a loader instead of
  // routing. Otherwise a hard refresh or deep link briefly reads as
  // "logged out" and bounces the user to /login and then to the dashboard.
  if (isLoading) {
    return <RouteFallback />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />

      {/* Self-registration is disabled: access is invite only (staff and
          tenants alike get a personal set-password link). Old links land on login. */}
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/signup" element={<Navigate to="/login" replace />} />

      <Route path="/forgot-password" element={
        <PublicRoute>
          <ForgotPassword />
        </PublicRoute>
      } />

      {/* Reachable from an emailed link, so it must work even if a stale
          session cookie is present. */}
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Public, no-login document signing for prospective tenants. */}
      <Route path="/sign/:token" element={<SigningPage />} />
      
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

      <Route path="/portal/maintenance" element={
        <PortalRoute>
          <PortalLayout><TenantMaintenance /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/documents" element={
        <PortalRoute>
          <PortalLayout><TenantDocuments /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/messages" element={
        <PortalRoute>
          <PortalLayout><PortalMessages /></PortalLayout>
        </PortalRoute>
      } />

      <Route path="/portal/install" element={
        <PortalRoute>
          <PortalLayout><InstallGuide /></PortalLayout>
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

      <Route path="/properties/:id" element={
        <ProtectedRoute requiredPermission="properties_view">
          <Layout><PropertyProfile /></Layout>
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

      <Route path="/messages" element={
        <ProtectedRoute requiredPermission="tenants_view">
          <Layout><Messages /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/prospective/:id" element={
        <ProtectedRoute requiredPermission="tenants_view">
          <Layout><ProspectiveTenantDetail /></Layout>
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
      
      <Route path="/capital-projects" element={
        <ProtectedRoute requiredPermission="finances_capital_projects">
          <Layout><CapitalProjects /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/expense-imports" element={
        <ProtectedRoute requiredPermission="finances_import">
          <Layout><ExpenseImport /></Layout>
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

      <Route path="/calendar" element={
        <ProtectedRoute requiredPermission="finances_view">
          <Layout><Calendar /></Layout>
        </ProtectedRoute>
      } />

      {/* Admins and Super Admins only; the Activity page enforces the role and
          the server does too. */}
      <Route path="/activity" element={
        <ProtectedRoute>
          <Layout><Activity /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/announcements" element={
        <ProtectedRoute requiredPermission="announcements_send">
          <Layout><Announcements /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/ai-assistant" element={
        <ProtectedRoute requiredPermission="ai_assistant_use">
          <Layout><AIAssistant /></Layout>
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
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
