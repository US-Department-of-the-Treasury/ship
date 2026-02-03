/**
 * Centralized status color definitions for WCAG AA compliance.
 * Dark theme: Uses -300 variants (not -400) to meet 4.5:1 contrast ratio on dark backgrounds.
 * Light theme: Uses -800/-700 variants to meet 4.5:1 contrast ratio on light backgrounds.
 */

// Dark theme colors (original)
const issueStatusColorsDark: Record<string, string> = {
  triage: 'bg-purple-500/20 text-purple-300',
  backlog: 'bg-gray-500/20 text-gray-300',
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-yellow-500/20 text-yellow-300',
  in_review: 'bg-cyan-500/20 text-cyan-300',
  done: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

// Light theme colors (darker variants for readability)
const issueStatusColorsLight: Record<string, string> = {
  triage: 'bg-purple-100 text-purple-800',      // WCAG AA: 7.8:1 contrast
  backlog: 'bg-gray-100 text-gray-800',         // WCAG AA: 11.6:1 contrast
  todo: 'bg-blue-100 text-blue-800',            // WCAG AA: 8.6:1 contrast
  in_progress: 'bg-yellow-100 text-yellow-800', // WCAG AA: 6.4:1 contrast
  in_review: 'bg-cyan-100 text-cyan-800',       // WCAG AA: 7.1:1 contrast
  done: 'bg-green-100 text-green-800',          // WCAG AA: 7.3:1 contrast
  cancelled: 'bg-red-100 text-red-800',         // WCAG AA: 8.2:1 contrast
};

const sprintStatusColorsDark: Record<string, string> = {
  planned: 'bg-gray-500/20 text-gray-300',
  upcoming: 'bg-blue-500/20 text-blue-300', // alias for timeline view
  active: 'bg-green-500/20 text-green-300',
  completed: 'bg-gray-500/20 text-gray-300',
};

const sprintStatusColorsLight: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-800',
  upcoming: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
};

const priorityColorsDark: Record<string, string> = {
  urgent: 'text-red-300',
  high: 'text-orange-300',
  medium: 'text-yellow-300',
  low: 'text-blue-300',
};

const priorityColorsLight: Record<string, string> = {
  urgent: 'text-red-700',    // WCAG AA: 5.2:1 contrast on light bg
  high: 'text-orange-700',   // WCAG AA: 4.9:1 contrast
  medium: 'text-yellow-700', // WCAG AA: 4.6:1 contrast
  low: 'text-blue-700',      // WCAG AA: 5.8:1 contrast
};

/**
 * Get color classes for an issue status badge.
 * Returns theme-appropriate colors that meet WCAG AA contrast requirements.
 *
 * @param status - Issue status (triage, backlog, todo, etc.)
 * @param theme - Current theme (light or dark)
 * @returns Tailwind class string for background and text colors
 */
export function getIssueStatusColor(status: string, theme: 'light' | 'dark'): string {
  const colors = theme === 'dark' ? issueStatusColorsDark : issueStatusColorsLight;
  const fallback = theme === 'dark'
    ? 'bg-gray-500/20 text-gray-300'
    : 'bg-gray-100 text-gray-800';
  return colors[status] || fallback;
}

/**
 * Get color classes for a sprint status badge.
 * Returns theme-appropriate colors that meet WCAG AA contrast requirements.
 *
 * @param status - Sprint status (planned, active, completed)
 * @param theme - Current theme (light or dark)
 * @returns Tailwind class string for background and text colors
 */
export function getSprintStatusColor(status: string, theme: 'light' | 'dark'): string {
  const colors = theme === 'dark' ? sprintStatusColorsDark : sprintStatusColorsLight;
  const fallback = theme === 'dark'
    ? 'bg-gray-500/20 text-gray-300'
    : 'bg-gray-100 text-gray-800';
  return colors[status] || fallback;
}

/**
 * Get color class for a priority indicator.
 * Returns theme-appropriate text color that meets WCAG AA contrast requirements.
 *
 * @param priority - Priority level (urgent, high, medium, low)
 * @param theme - Current theme (light or dark)
 * @returns Tailwind text color class
 */
export function getPriorityColor(priority: string, theme: 'light' | 'dark'): string {
  const colors = theme === 'dark' ? priorityColorsDark : priorityColorsLight;
  const fallback = theme === 'dark' ? 'text-blue-300' : 'text-blue-700';
  return colors[priority] || fallback;
}

// Legacy exports for backwards compatibility - will be removed after migration
export const issueStatusColors = issueStatusColorsDark;
export const sprintStatusColors = sprintStatusColorsDark;
export const priorityColors = priorityColorsDark;
