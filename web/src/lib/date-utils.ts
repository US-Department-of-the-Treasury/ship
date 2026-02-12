/**
 * Shared date formatting utilities.
 *
 * formatDate        - relative time for recent, "Mon D" for older
 * formatRelativeTime - relative time string (just now, Xm ago, Xh ago, etc.)
 * formatDateRange   - compact range like "Jan 6-12" or "Jan 30 - Feb 5"
 */

/** Format a date as relative time for recent dates, "Mon D" for older. */
export function formatDate(dateString: string | null): string {
  if (!dateString) return 'Unknown date';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a date as a relative time string (just now, Xm ago, yesterday, etc.). */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format a date range for display (e.g., "Jan 6-12" or "Jan 30 - Feb 5").
 * Accepts either ISO date strings (YYYY-MM-DD) or Date objects.
 */
export function formatDateRange(start: string | Date, end: string | Date): string {
  const startDate = typeof start === 'string' ? new Date(start + 'T00:00:00Z') : start;
  const endDate = typeof end === 'string' ? new Date(end + 'T00:00:00Z') : end;

  const isUTC = typeof start === 'string';

  const startMonth = isUTC
    ? startDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    : startDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = isUTC ? startDate.getUTCDate() : startDate.getDate();
  const endMonth = isUTC
    ? endDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    : endDate.toLocaleDateString('en-US', { month: 'short' });
  const endDay = isUTC ? endDate.getUTCDate() : endDate.getDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}
