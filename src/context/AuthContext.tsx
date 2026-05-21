import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi } from '../lib/api';
import type { User, Role, Permission } from '../types/auth';
import { DEFAULT_ROLES, SYSTEM_PERMISSIONS } from '../types/auth';

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
  addRole: (role: Omit<Role, 'id'>) => void;
  updateRole: (role: Role) => void;
  deleteRole: (id: string) => void;
  addUser: (user: Omit<User, 'id' | 'createdAt' | 'role'> & { roleId: string }) => void;
  updateUser: (user: User) => void;
  deleteUser: (id: string) => void;
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

  useEffect(() => {
    const checkSession = async () => {
      try {
        const result = await authApi.getSession();
        console.log('Session check result:', result);
        
        // Handle both API formats
        const userData = result?.user || result?.data?.user;
        
        if (userData) {
          const sessionUser = userData as Record<string, unknown>;
          const role = roles.find(r => r.id === (sessionUser.role as string)) || DEFAULT_ROLES[0];
          setUser(mapSessionUser({ ...sessionUser, roleId: sessionUser.role }, role));
        }
      } catch (error) {
        console.error('Session check error:', error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const result = await authApi.signIn(email, password);
      console.log('Login result:', result);
      
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
      console.error('Login error:', error);
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
      if (result?.data?.user) {
        const sessionUser = result.data.user as Record<string, unknown>;
        const role = roles.find(r => r.id === 'super_admin') || DEFAULT_ROLES[0];
        setUser(mapSessionUser(sessionUser, role));
        return { success: true };
      }
      return { success: false, error: 'Registration failed' };
    } catch (error) {
      console.error('Registration error:', error);
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

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const addRole = (role: Omit<Role, 'id'>) => {
    const newRole = { ...role, id: generateId() };
    setRoles(prev => [...prev, newRole]);
  };

  const updateRole = (role: Role) => {
    setRoles(prev => prev.map(r => r.id === role.id ? role : r));
    setUsers(prev => prev.map(u =>
      u.roleId === role.id ? { ...u, role } : u
    ));
  };

  const deleteRole = (id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
  };

  const addUser = (userData: Omit<User, 'id' | 'createdAt' | 'role'> & { roleId: string }) => {
    const role = roles.find(r => r.id === userData.roleId) || DEFAULT_ROLES[0];
    const newUser: User = {
      ...userData,
      id: generateId(),
      createdAt: new Date().toISOString(),
      role,
    };
    setUsers(prev => [...prev, newUser]);
  };

  const updateUser = (updatedUser: User) => {
    const role = roles.find(r => r.id === updatedUser.roleId) || DEFAULT_ROLES[0];
    const userWithRole = { ...updatedUser, role };
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? userWithRole : u));
    if (user?.id === updatedUser.id) {
      setUser(userWithRole);
    }
  };

  const deleteUser = (id: string) => {
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
