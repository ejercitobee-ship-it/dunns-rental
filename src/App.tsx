import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Properties } from './pages/Properties';
import { Tenants } from './pages/Tenants';
import { Rents } from './pages/Rents';
import { Expenses } from './pages/Expenses';
import { TaxReport } from './pages/TaxReport';
import { DataMigration } from './pages/DataMigration';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';

// Protected Route component
function ProtectedRoute({ children, requiredPermission }: { children: React.ReactNode; requiredPermission?: string }) {
  const { isAuthenticated, hasPermission } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
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
      
      <Route path="/" element={
        <ProtectedRoute>
          <Layout><Dashboard /></Layout>
        </ProtectedRoute>
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
      
      <Route path="/rents" element={
        <ProtectedRoute requiredPermission="rents_view">
          <Layout><Rents /></Layout>
        </ProtectedRoute>
      } />
      
      <Route path="/finances" element={
        <ProtectedRoute requiredPermission="finances_view">
          <Layout><Expenses /></Layout>
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
