import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { User, Role, AuthState, Permission } from '../types/auth';
import { DEFAULT_ROLES, DEFAULT_SUPER_ADMIN, SYSTEM_PERMISSIONS } from '../types/auth';

type AuthAction =
  | { type: 'LOGIN'; payload: { user: User; token: string } }
  | { type: 'LOGOUT' }
  | { type: 'UPDATE_USER'; payload: User }
  | { type: 'SET_ROLES'; payload: Role[] }
  | { type: 'ADD_ROLE'; payload: Role }
  | { type: 'UPDATE_ROLE'; payload: Role }
  | { type: 'DELETE_ROLE'; payload: string }
  | { type: 'ADD_USER'; payload: User }
  | { type: 'UPDATE_USER'; payload: User }
  | { type: 'DELETE_USER'; payload: string };

interface AuthContextType extends AuthState {
  roles: Role[];
  users: User[];
  permissions: Permission[];
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
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

const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  token: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN':
      return {
        ...state,
        isAuthenticated: true,
        user: action.payload.user,
        token: action.payload.token,
      };
    case 'LOGOUT':
      return {
        ...state,
        isAuthenticated: false,
        user: null,
        token: null,
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: state.user?.id === action.payload.id ? action.payload : state.user,
      };
    default:
      return state;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const [roles, setRoles] = React.useState<Role[]>(DEFAULT_ROLES);
  const [users, setUsers] = React.useState<User[]>([DEFAULT_SUPER_ADMIN]);

  // Load from localStorage on mount
  useEffect(() => {
    const savedAuth = localStorage.getItem('rentmaster-auth');
    const savedRoles = localStorage.getItem('rentmaster-roles');
    const savedUsers = localStorage.getItem('rentmaster-users');

    if (savedAuth) {
      try {
        const parsed = JSON.parse(savedAuth);
        dispatch({ type: 'LOGIN', payload: parsed });
      } catch (e) {
        console.error('Failed to load auth:', e);
      }
    }

    if (savedRoles) {
      try {
        setRoles(JSON.parse(savedRoles));
      } catch (e) {
        console.error('Failed to load roles:', e);
      }
    }

    if (savedUsers) {
      try {
        setUsers(JSON.parse(savedUsers));
      } catch (e) {
        console.error('Failed to load users:', e);
      }
    }
  }, []);

  // Save to localStorage on changes
  useEffect(() => {
    if (state.isAuthenticated) {
      localStorage.setItem('rentmaster-auth', JSON.stringify({
        user: state.user,
        token: state.token,
      }));
    } else {
      localStorage.removeItem('rentmaster-auth');
    }
  }, [state]);

  useEffect(() => {
    localStorage.setItem('rentmaster-roles', JSON.stringify(roles));
  }, [roles]);

  useEffect(() => {
    localStorage.setItem('rentmaster-users', JSON.stringify(users));
  }, [users]);

  const login = async (email: string, password: string): Promise<boolean> => {
    // Demo login - in production, this would call an API
    const user = users.find(u => u.email === email && u.isActive);
    
    if (user && password === 'password') { // Demo password
      const role = roles.find(r => r.id === user.roleId) || DEFAULT_ROLES[0];
      const userWithRole = { ...user, role };
      
      dispatch({
        type: 'LOGIN',
        payload: {
          user: userWithRole,
          token: 'demo-token-' + Date.now(),
        },
      });
      
      // Update last login
      const updatedUser = { ...userWithRole, lastLogin: new Date().toISOString() };
      setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
      
      return true;
    }
    
    return false;
  };

  const logout = () => {
    dispatch({ type: 'LOGOUT' });
  };

  const hasPermission = (permissionId: string): boolean => {
    if (!state.user) return false;
    return state.user.role.permissions.includes(permissionId);
  };

  const hasAnyPermission = (permissionIds: string[]): boolean => {
    if (!state.user) return false;
    return permissionIds.some(id => state.user!.role.permissions.includes(id));
  };

  const hasModuleAccess = (module: string): boolean => {
    if (!state.user) return false;
    return SYSTEM_PERMISSIONS.some(
      p => p.module === module && state.user!.role.permissions.includes(p.id)
    );
  };

  const isSuperAdmin = (): boolean => {
    return state.user?.roleId === 'super_admin';
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const addRole = (role: Omit<Role, 'id'>) => {
    const newRole = { ...role, id: generateId() };
    setRoles(prev => [...prev, newRole]);
  };

  const updateRole = (role: Role) => {
    setRoles(prev => prev.map(r => r.id === role.id ? role : r));
    // Update users with this role
    setUsers(prev => prev.map(u => 
      u.roleId === role.id ? { ...u, role } : u
    ));
  };

  const deleteRole = (id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
  };

  const addUser = (user: Omit<User, 'id' | 'createdAt' | 'role'> & { roleId: string }) => {
    const role = roles.find(r => r.id === user.roleId) || DEFAULT_ROLES[0];
    const newUser: User = {
      ...user,
      id: generateId(),
      createdAt: new Date().toISOString(),
      role,
    };
    setUsers(prev => [...prev, newUser]);
  };

  const updateUser = (user: User) => {
    const role = roles.find(r => r.id === user.roleId) || DEFAULT_ROLES[0];
    const updatedUser = { ...user, role };
    setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
    
    if (state.user?.id === user.id) {
      dispatch({ type: 'UPDATE_USER', payload: updatedUser });
    }
  };

  const deleteUser = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        roles,
        users,
        permissions: SYSTEM_PERMISSIONS,
        login,
        logout,
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
