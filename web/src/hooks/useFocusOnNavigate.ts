import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Focus management hook for accessibility (WCAG 2.4.3)
 * Moves focus to main content on navigation and updates page title
 */
export function useFocusOnNavigate() {
  const location = useLocation();

  useEffect(() => {
    // Focus the main content area on route change
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      // Small delay to ensure DOM is updated
      requestAnimationFrame(() => {
        mainContent.focus();
      });
    }

    // Update page title based on route (for screen reader announcements)
    const pageTitle = getPageTitle(location.pathname);
    document.title = pageTitle ? `${pageTitle} | Ship` : 'Ship';
  }, [location.pathname]);
}

function getPageTitle(pathname: string): string {
  if (pathname === '/' || pathname === '/docs') return 'Documents';
  if (pathname.startsWith('/docs/')) return 'Document';
  if (pathname === '/issues') return 'Issues';
  if (pathname.startsWith('/issues/')) return 'Issue';
  if (pathname === '/programs') return 'Programs';
  if (pathname.startsWith('/programs/')) return 'Program';
  if (pathname.startsWith('/sprints/')) return 'Sprint';
  if (pathname === '/team' || pathname === '/team/allocation') return 'Team Allocation';
  if (pathname === '/team/directory') return 'Team Directory';
  if (pathname === '/settings') return 'Settings';
  return 'Ship';
}
