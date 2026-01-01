import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export function LoginPage() {
  const [email, setEmail] = useState(import.meta.env.DEV ? 'dev@ship.local' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'admin123' : '');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // Check if setup is needed before showing login
  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch(`${API_URL}/api/setup/status`, {
          credentials: 'include',
        });
        const data = await res.json();

        if (data.success && data.data.needsSetup) {
          navigate('/setup', { replace: true });
          return;
        }
      } catch (err) {
        // If we can't check, just show login
        console.error('Failed to check setup status:', err);
      }
      setIsCheckingSetup(false);
    }
    checkSetup();
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(email, password);

    if (result.success) {
      navigate(from, { replace: true });
    } else {
      setError(result.error || 'Login failed');
      setIsLoading(false);
    }
  }

  if (isCheckingSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[360px]">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <img
            src="/icons/white/logo-128.png"
            alt="Ship"
            className="mx-auto h-16 w-16"
          />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Ship</h1>
          <p className="mt-2 text-sm text-muted">Sign in to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className={cn(
                'w-full rounded-md border border-border bg-background px-4 py-2.5',
                'text-sm text-foreground placeholder:text-muted',
                'transition-colors focus:border-accent focus:outline-none'
              )}
            />
          </div>

          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={cn(
                'w-full rounded-md border border-border bg-background px-4 py-2.5',
                'text-sm text-foreground placeholder:text-muted',
                'transition-colors focus:border-accent focus:outline-none'
              )}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              'w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white',
              'transition-colors hover:bg-accent-hover',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Dev credentials hint - only shown in development */}
        {import.meta.env.DEV && (
          <div className="mt-8 text-center text-xs text-muted">
            <p>Dev credentials:</p>
            <p className="mt-1 font-mono text-muted">
              dev@ship.local / admin123
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
