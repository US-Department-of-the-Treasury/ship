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

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ user: { id: string; email: string; name: string } }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }
      ),
    logout: () => {
      clearCsrfToken(); // Clear token on logout
      return request('/api/auth/logout', {
        method: 'POST',
      });
    },
    me: () =>
      request<{ user: { id: string; email: string; name: string } }>(
        '/api/auth/me'
      ),
  },
};
