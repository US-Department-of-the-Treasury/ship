const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// CSRF token cache for state-changing requests
let csrfToken: string | null = null;

async function ensureCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, {
      credentials: 'include',
    });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

// Clear CSRF token on logout or session change
export function clearCsrfToken(): void {
  csrfToken = null;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Add CSRF token for state-changing requests
  const method = options.method?.toUpperCase() || 'GET';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await ensureCsrfToken();
    headers['X-CSRF-Token'] = token;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  // If CSRF token is invalid, clear and retry once
  if (response.status === 403) {
    const data = await response.json();
    if (data.error?.code === 'CSRF_ERROR') {
      csrfToken = null;
      const token = await ensureCsrfToken();
      headers['X-CSRF-Token'] = token;
      const retryResponse = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        credentials: 'include',
        headers,
      });
      return retryResponse.json();
    }
  }

  return response.json();
}

// Types for workspace management
export interface Workspace {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'admin' | 'member';
  personDocumentId: string | null;
  createdAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string | null;
  actorUserId: string;
  actorName: string;
  actorEmail: string;
  impersonatingUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  personDocumentId: string | null;
  joinedAt: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
}

export interface LoginResponse {
  user: UserInfo;
  currentWorkspace: Workspace;
  workspaces: Array<Workspace & { role: 'admin' | 'member' }>;
}

export interface MeResponse {
  user: UserInfo;
  currentWorkspace: Workspace | null;
  workspaces: Array<Workspace & { role: 'admin' | 'member' }>;
  impersonating?: {
    userId: string;
    userName: string;
  };
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => {
      clearCsrfToken(); // Clear token on logout
      return request('/api/auth/logout', {
        method: 'POST',
      });
    },
    me: () => request<MeResponse>('/api/auth/me'),
  },

  workspaces: {
    // User-facing workspace operations
    list: () =>
      request<Array<Workspace & { role: 'admin' | 'member' }>>('/api/workspaces'),

    getCurrent: () =>
      request<Workspace>('/api/workspaces/current'),

    switch: (workspaceId: string) =>
      request<{ workspace: Workspace }>(`/api/workspaces/${workspaceId}/switch`, {
        method: 'POST',
      }),

    // Member management (workspace admin)
    getMembers: (workspaceId: string) =>
      request<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspaceId}/members`),

    addMember: (workspaceId: string, data: { userId?: string; email?: string; role: 'admin' | 'member' }) =>
      request<WorkspaceMembership>(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateMember: (workspaceId: string, userId: string, data: { role: 'admin' | 'member' }) =>
      request<WorkspaceMembership>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    removeMember: (workspaceId: string, userId: string) =>
      request(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      }),

    // Invite management (workspace admin)
    getInvites: (workspaceId: string) =>
      request<{ invites: WorkspaceInvite[] }>(`/api/workspaces/${workspaceId}/invites`),

    createInvite: (workspaceId: string, data: { email: string; role?: 'admin' | 'member' }) =>
      request<{ invite: WorkspaceInvite }>(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    revokeInvite: (workspaceId: string, inviteId: string) =>
      request(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
      }),

    // Audit logs (workspace admin)
    getAuditLogs: (workspaceId: string, params?: { limit?: number; offset?: number }) =>
      request<{ logs: AuditLog[] }>(
        `/api/workspaces/${workspaceId}/audit-logs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`
      ),
  },

  admin: {
    // Super-admin workspace management
    listWorkspaces: (includeArchived = false) =>
      request<{ workspaces: Array<Workspace & { memberCount: number }> }>(`/api/admin/workspaces?archived=${includeArchived}`),

    createWorkspace: (data: { name: string }) =>
      request<{ workspace: Workspace }>('/api/admin/workspaces', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateWorkspace: (workspaceId: string, data: { name?: string }) =>
      request<Workspace>(`/api/admin/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    archiveWorkspace: (workspaceId: string) =>
      request<Workspace>(`/api/admin/workspaces/${workspaceId}/archive`, {
        method: 'POST',
      }),

    // Super-admin user management
    listUsers: () =>
      request<{ users: Array<UserInfo & { workspaces: Array<{ id: string; name: string; role: 'admin' | 'member' }> }> }>('/api/admin/users'),

    toggleSuperAdmin: (userId: string, isSuperAdmin: boolean) =>
      request<UserInfo>(`/api/admin/users/${userId}/super-admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isSuperAdmin }),
      }),

    // Audit logs (super-admin)
    getAuditLogs: (params?: { workspaceId?: string; userId?: string; action?: string; limit?: number; offset?: number }) =>
      request<{ logs: AuditLog[] }>(`/api/admin/audit-logs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`),

    exportAuditLogs: (params?: { workspaceId?: string; userId?: string; action?: string; from?: string; to?: string }) =>
      `${API_URL}/api/admin/audit-logs/export${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`,

    // Impersonation
    startImpersonation: (userId: string) =>
      request<{ originalUserId: string; impersonating: { userId: string; userName: string } }>(`/api/admin/impersonate/${userId}`, {
        method: 'POST',
      }),

    endImpersonation: () =>
      request('/api/admin/impersonate', {
        method: 'DELETE',
      }),
  },

  invites: {
    // Public invite operations
    validate: (token: string) =>
      request<{ email: string; workspaceName: string; invitedBy: string; role: 'admin' | 'member' }>(`/api/invites/${token}`),

    accept: (token: string, data?: { password?: string; name?: string }) =>
      request<LoginResponse>(`/api/invites/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
  },
};
