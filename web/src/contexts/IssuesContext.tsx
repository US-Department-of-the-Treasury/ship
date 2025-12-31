import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  program_id: string | null;
  sprint_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  sprint_name: string | null;
  source: 'internal' | 'feedback';
  rejection_reason: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
}

interface IssuesContextValue {
  issues: Issue[];
  loading: boolean;
  createIssue: () => Promise<Issue | null>;
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  refreshIssues: () => Promise<void>;
}

const IssuesContext = createContext<IssuesContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, {
      credentials: 'include',
    });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

async function apiPost(endpoint: string, body?: object) {
  const token = await getCsrfToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // If CSRF token invalid, retry once
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  return res;
}

async function apiPatch(endpoint: string, body: object) {
  const token = await getCsrfToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  return res;
}

export function IssuesProvider({ children }: { children: ReactNode }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshIssues = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/issues`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setIssues(data);
      }
    } catch (err) {
      console.error('Failed to fetch issues:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshIssues();
  }, [refreshIssues]);

  const createIssue = useCallback(async (): Promise<Issue | null> => {
    try {
      const res = await apiPost('/api/issues', { title: 'Untitled' });
      if (res.ok) {
        const issue = await res.json();
        setIssues(prev => [issue, ...prev]);
        return issue;
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
    return null;
  }, []);

  const updateIssue = useCallback(async (id: string, updates: Partial<Issue>): Promise<Issue | null> => {
    try {
      const res = await apiPatch(`/api/issues/${id}`, updates);
      if (res.ok) {
        const updated = await res.json();
        // Update the issue in the shared state
        setIssues(prev => prev.map(i => i.id === id ? updated : i));
        return updated;
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
    return null;
  }, []);

  return (
    <IssuesContext.Provider value={{ issues, loading, createIssue, updateIssue, refreshIssues }}>
      {children}
    </IssuesContext.Provider>
  );
}

export function useIssues() {
  const context = useContext(IssuesContext);
  if (!context) {
    throw new Error('useIssues must be used within IssuesProvider');
  }
  return context;
}
