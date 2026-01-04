/**
 * Centralized status color definitions for WCAG AA compliance.
 * Uses -300 variants (not -400) to meet 4.5:1 contrast ratio on dark backgrounds.
 */

export const issueStatusColors: Record<string, string> = {
  backlog: 'bg-gray-500/20 text-gray-300',
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-yellow-500/20 text-yellow-300',
  done: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

export const sprintStatusColors: Record<string, string> = {
  planned: 'bg-gray-500/20 text-gray-300',
  upcoming: 'bg-blue-500/20 text-blue-300', // alias for timeline view
  active: 'bg-green-500/20 text-green-300',
  completed: 'bg-gray-500/20 text-gray-300',
};

export const feedbackStatusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  submitted: 'bg-purple-500/20 text-purple-300',
  pending: 'bg-yellow-500/20 text-yellow-300',
  accepted: 'bg-green-500/20 text-green-300',
  rejected: 'bg-red-500/20 text-red-300',
};

export const priorityColors: Record<string, string> = {
  urgent: 'text-red-300',
  high: 'text-orange-300',
  medium: 'text-yellow-300',
  low: 'text-blue-300',
};

// Helper to get status color with fallback
export function getStatusColor(
  colors: Record<string, string>,
  status: string,
  fallback = 'bg-gray-500/20 text-gray-300'
): string {
  return colors[status] || fallback;
}
