import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { api, UserInfo, Workspace } from '@/lib/api';
import { useWorkspace, WorkspaceWithRole } from '@/contexts/WorkspaceContext';

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  isSuperAdmin: boolean;
  impersonating: { userId: string; userName: string } | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  endImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState<{ userId: string; userName: string } | null>(null);
  const { setCurrentWorkspace, setWorkspaces } = useWorkspace();

  const isSuperAdmin = user?.isSuperAdmin ?? false;

  // Check session on mount
  useEffect(() => {
    api.auth.me().then((response) => {
      if (response.success && response.data) {
        setUser(response.data.user);
        setCurrentWorkspace(response.data.currentWorkspace);
        setWorkspaces(response.data.workspaces);
        if (response.data.impersonating) {
          setImpersonating(response.data.impersonating);
        }
      }
      setLoading(false);
    });
  }, [setCurrentWorkspace, setWorkspaces]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.auth.login(email, password);
    if (response.success && response.data) {
      setUser(response.data.user);
      setCurrentWorkspace(response.data.currentWorkspace);
      setWorkspaces(response.data.workspaces);
      return { success: true };
    }
    return {
      success: false,
      error: response.error?.message || 'Login failed',
    };
  }, [setCurrentWorkspace, setWorkspaces]);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    setCurrentWorkspace(null);
    setWorkspaces([]);
    setImpersonating(null);
  }, [setCurrentWorkspace, setWorkspaces]);

  const endImpersonation = useCallback(async () => {
    const response = await api.admin.endImpersonation();
    if (response.success) {
      setImpersonating(null);
      // Refresh session to get original user context
      const meResponse = await api.auth.me();
      if (meResponse.success && meResponse.data) {
        setUser(meResponse.data.user);
        setCurrentWorkspace(meResponse.data.currentWorkspace);
        setWorkspaces(meResponse.data.workspaces);
      }
    }
  }, [setCurrentWorkspace, setWorkspaces]);

  return (
    <AuthContext.Provider value={{ user, loading, isSuperAdmin, impersonating, login, logout, endImpersonation }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
