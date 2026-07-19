import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { authApi, rolesApi, adminApi, type ApiUser } from '../lib/api';
import type { User, Role, Permission } from '../types/auth';
import { DEFAULT_ROLES, SYSTEM_PERMISSIONS } from '../types/auth';

// Map a user record from the API into the app's User shape, attaching the
// full Role object resolved from the roles list.
function mapApiUser(apiUser: ApiUser, rolesList: Role[]): User {
  const role = rolesList.find(r => r.id === apiUser.roleId) || DEFAULT_ROLES[0];
  return {
    id: apiUser.id,
    firstName: apiUser.firstName,
    lastName: apiUser.lastName,
    email: apiUser.email,
    phone: apiUser.phone,
    department: apiUser.department,
    roleId: apiUser.roleId,
    role,
    isActive: apiUser.isActive,
    createdAt: apiUser.createdAt,
    photoUrl: apiUser.photoUrl,
  };
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  roles: Role[];
  users: User[];
  permissions: Permission[];
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  hasPermission: (permissionId: string) => boolean;
  hasAnyPermission: (permissionIds: string[]) => boolean;
  hasModuleAccess: (module: string) => boolean;
  addRole: (role: Omit<Role, 'id'>) => Promise<void>;
  updateRole: (role: Role) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  addUser: (user: Omit<User, 'id' | 'createdAt' | 'role'> & { roleId: string }) => Promise<{ tempPassword?: string }>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  refreshTeam: () => Promise<void>;
  isSuperAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapSessionUser(sessionUser: Record<string, unknown>, role: Role): User {
  const name = (sessionUser.name as string) || '';
  const parts = name.split(' ');
  return {
    id: sessionUser.id as string,
    firstName: (sessionUser.firstName as string) || parts[0] || '',
    lastName: (sessionUser.lastName as string) || parts.slice(1).join(' ') || '',
    email: sessionUser.email as string,
    avatar: (sessionUser.image as string) || undefined,
    roleId: (sessionUser.roleId as string) || 'viewer',
    role,
    isActive: true,
    lastLogin: new Date().toISOString(),
    createdAt: (sessionUser.createdAt as string) || new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>(DEFAULT_ROLES);
  const [users, setUsers] = useState<User[]>([]);

  // Auto-logout after 30 minutes of inactivity
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetInactivityTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    
    if (user) {
      inactivityTimerRef.current = setTimeout(() => {
        logout();
        window.location.href = '/login?reason=inactive';
      }, INACTIVITY_TIMEOUT);
    }
  }, [user]);

  const handleActivity = useCallback(() => {
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  useEffect(() => {
    if (!user) return;

    // Track user activity
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start the timer
    resetInactivityTimer();

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [user, handleActivity, resetInactivityTimer]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const result = await authApi.getSession();

        // Handle both API formats
        const userData = result?.user || result?.data?.user;
        
        if (userData) {
          const sessionUser = userData as Record<string, unknown>;
          const role = roles.find(r => r.id === (sessionUser.role as string)) || DEFAULT_ROLES[0];
          setUser(mapSessionUser({ ...sessionUser, roleId: sessionUser.role }, role));
        }
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();
  }, []);

  // Load roles (and, if permitted, the team member list) from the server once
  // the user is authenticated. Roles drive permission checks in the UI.
  const refreshTeam = useCallback(async () => {
    let currentRoles: Role[] = DEFAULT_ROLES;
    try {
      const apiRoles = await rolesApi.getAll();
      if (apiRoles?.length) {
        currentRoles = apiRoles;
        setRoles(apiRoles);
        // Re-resolve the signed-in user's role in case it is a custom role.
        setUser(prev =>
          prev ? { ...prev, role: apiRoles.find(r => r.id === prev.roleId) || prev.role } : prev
        );
      }
    } catch {
      // Keep the built-in defaults if roles can't be loaded.
    }
    try {
      const apiUsers = await adminApi.listUsers();
      setUsers(apiUsers.map(u => mapApiUser(u, currentRoles)));
    } catch {
      // No permission to list users (e.g. viewers) or request failed.
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    // refreshTeam only updates state after its async fetches resolve, so the
    // "setState in effect" cascade warning does not apply.
    if (user) refreshTeam(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [user?.id, refreshTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email: string, password: string) => {
    try {
      const result = await authApi.signIn(email, password);

      // Our custom API returns { success: true, user: {...} }
      if (result?.success && result?.user) {
        const sessionUser = result.user as Record<string, unknown>;
        const role = roles.find(r => r.id === (sessionUser.role as string)) || DEFAULT_ROLES[0];
        setUser(mapSessionUser({ ...sessionUser, roleId: sessionUser.role }, role));
        
        // Check if user needs to reset password
        if (result.forcePasswordReset) {
          return { success: true, forcePasswordReset: true };
        }
        
        return { success: true };
      }
      
      // Better-Auth format: { data: { user: ... } }
      if (result?.data?.user) {
        const sessionUser = result.data.user as Record<string, unknown>;
        const role = roles.find(r => r.id === (sessionUser.roleId as string)) || DEFAULT_ROLES[0];
        setUser(mapSessionUser(sessionUser, role));
        return { success: true };
      }
      
      return { success: false, error: 'Invalid credentials' };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const logout = async () => {
    try {
      await authApi.signOut();
    } finally {
      setUser(null);
    }
  };

  const register = async (email: string, password: string, name: string) => {
    try {
      const result = await authApi.signUp(email, password, name);
      if (result?.success && result?.user) {
        const sessionUser = result.user as Record<string, unknown>;
        const role = roles.find(r => r.id === (sessionUser.role as string)) || DEFAULT_ROLES[0];
        setUser(mapSessionUser({ ...sessionUser, roleId: sessionUser.role }, role));
        return { success: true };
      }
      return { success: false, error: 'Registration failed' };
    } catch (error) {
      return { success: false, error: (error as Error).message || 'Registration failed. Please try again.' };
    }
  };

  const hasPermission = (permissionId: string): boolean => {
    if (!user) return false;
    return user.role.permissions.includes(permissionId);
  };

  const hasAnyPermission = (permissionIds: string[]): boolean => {
    if (!user) return false;
    return permissionIds.some(id => user.role.permissions.includes(id));
  };

  const hasModuleAccess = (module: string): boolean => {
    if (!user) return false;
    return SYSTEM_PERMISSIONS.some(
      p => p.module === module && user.role.permissions.includes(p.id)
    );
  };

  const isSuperAdmin = (): boolean => {
    return user?.roleId === 'super_admin';
  };

  const addRole = async (role: Omit<Role, 'id'>) => {
    const created = await rolesApi.create({
      name: role.name,
      description: role.description,
      permissions: role.permissions,
    });
    setRoles(prev => [...prev, created]);
  };

  const updateRole = async (role: Role) => {
    const updated = await rolesApi.update(role.id, {
      name: role.name,
      description: role.description,
      permissions: role.permissions,
    });
    setRoles(prev => prev.map(r => (r.id === updated.id ? updated : r)));
    setUsers(prev => prev.map(u => (u.roleId === updated.id ? { ...u, role: updated } : u)));
    // If the change affected the current user's role, refresh their permissions.
    setUser(prev => (prev && prev.roleId === updated.id ? { ...prev, role: updated } : prev));
  };

  const deleteRole = async (id: string) => {
    await rolesApi.delete(id);
    setRoles(prev => prev.filter(r => r.id !== id));
  };

  const addUser = async (userData: Omit<User, 'id' | 'createdAt' | 'role'> & { roleId: string }) => {
    const result = await adminApi.createUser({
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email,
      roleId: userData.roleId,
      phone: userData.phone,
      department: userData.department,
    });
    await refreshTeam();
    return { tempPassword: (result as { tempPassword?: string })?.tempPassword };
  };

  const updateUser = async (updatedUser: User) => {
    const saved = await adminApi.updateUser(updatedUser.id, {
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      phone: updatedUser.phone,
      department: updatedUser.department,
      isActive: updatedUser.isActive,
      roleId: updatedUser.roleId,
    });
    const mapped = mapApiUser(saved, roles);
    setUsers(prev => prev.map(u => (u.id === mapped.id ? mapped : u)));
    if (user?.id === mapped.id) setUser(mapped);
  };

  const deleteUser = async (id: string) => {
    await adminApi.deleteUser(id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        user,
        isLoading,
        roles,
        users,
        permissions: SYSTEM_PERMISSIONS,
        login,
        logout,
        register,
        hasPermission,
        hasAnyPermission,
        hasModuleAccess,
        addRole,
        updateRole,
        deleteRole,
        addUser,
        updateUser,
        deleteUser,
        refreshTeam,
        isSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
