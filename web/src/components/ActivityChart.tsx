import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL || '';

export type ActivityEntityType = 'program' | 'project' | 'sprint';

export interface ActivityDay {
  date: string;
  count: number;
}

export interface ActivityChartProps {
  entityType: ActivityEntityType;
  entityId: string;
  className?: string;
}

/**
 * ActivityChart - GitHub-style activity visualization
 *
 * Displays 30 days of activity as colored squares.
 * Darker color = more activity that day.
 * Hover shows tooltip with activity count.
 */
export function ActivityChart({ entityType, entityId, className }: ActivityChartProps) {
  const [activityData, setActivityData] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) return;

    setLoading(true);
    setError(null);

    fetch(`${API_URL}/api/activity/${entityType}/${entityId}`, {
      credentials: 'include',
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch activity: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        setActivityData(data.days || []);
      })
      .catch(err => {
        console.error('Activity fetch error:', err);
        setError(err.message);
        setActivityData([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [entityType, entityId]);

  // Generate the last 30 days
  const days = useMemo(() => {
    const result: { date: string; count: number; dayOfWeek: number }[] = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const activityDay = activityData.find(d => d.date === dateStr);

      result.push({
        date: dateStr,
        count: activityDay?.count || 0,
        dayOfWeek: date.getDay(),
      });
    }

    return result;
  }, [activityData]);

  // Calculate max count for scaling
  const maxCount = useMemo(() => {
    const max = Math.max(...days.map(d => d.count), 1);
    return max;
  }, [days]);

  // Get intensity level (0-4) for a given count
  const getIntensity = (count: number): number => {
    if (count === 0) return 0;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  };

  if (loading) {
    return (
      <div className={cn('flex gap-0.5', className)}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="h-3 w-3 animate-pulse rounded-sm bg-border/30"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('text-xs text-muted', className)}>
        Unable to load activity
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {days.map((day) => (
        <ActivitySquare
          key={day.date}
          date={day.date}
          count={day.count}
          intensity={getIntensity(day.count)}
        />
      ))}
    </div>
  );
}

interface ActivitySquareProps {
  date: string;
  count: number;
  intensity: number;
}

function ActivitySquare({ date, count, intensity }: ActivitySquareProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Format date for tooltip
  const formattedDate = useMemo(() => {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [date]);

  const intensityClasses: Record<number, string> = {
    0: 'bg-border/30',
    1: 'bg-accent/30',
    2: 'bg-accent/50',
    3: 'bg-accent/75',
    4: 'bg-accent',
  };

  return (
    <div className="relative">
      <div
        className={cn(
          'h-3 w-3 rounded-sm cursor-default transition-colors',
          intensityClasses[intensity]
        )}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-label={`${count} activities on ${formattedDate}`}
      />
      {showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-foreground text-background rounded shadow-lg whitespace-nowrap z-50"
          role="tooltip"
        >
          <div className="font-medium">{count} activit{count === 1 ? 'y' : 'ies'}</div>
          <div className="text-background/70">{formattedDate}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
        </div>
      )}
    </div>
  );
}

/**
 * ActivityChartMini - Compact version for cards and lists
 * Shows a simpler bar-style visualization
 */
export function ActivityChartMini({ entityType, entityId, className }: ActivityChartProps) {
  const [activityData, setActivityData] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityId) return;

    fetch(`${API_URL}/api/activity/${entityType}/${entityId}`, {
      credentials: 'include',
    })
      .then(res => res.ok ? res.json() : { days: [] })
      .then(data => setActivityData(data.days || []))
      .catch(() => setActivityData([]))
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  const totalActivity = useMemo(() => {
    return activityData.reduce((sum, d) => sum + d.count, 0);
  }, [activityData]);

  if (loading) {
    return <div className={cn('h-2 w-full animate-pulse rounded bg-border/30', className)} />;
  }

  // Generate simple bar visualization
  const days = useMemo(() => {
    const result: number[] = [];
    const today = new Date();

    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const activityDay = activityData.find(d => d.date === dateStr);
      result.push(activityDay?.count || 0);
    }

    return result;
  }, [activityData]);

  const maxCount = Math.max(...days, 1);

  return (
    <div className={cn('flex items-end gap-px h-6', className)} title={`${totalActivity} activities in last 14 days`}>
      {days.map((count, i) => {
        const height = count > 0 ? Math.max((count / maxCount) * 100, 15) : 0;
        return (
          <div
            key={i}
            className={cn(
              'flex-1 rounded-t-sm transition-all',
              count > 0 ? 'bg-accent/70' : 'bg-border/30'
            )}
            style={{ height: count > 0 ? `${height}%` : '2px' }}
          />
        );
      })}
    </div>
  );
}
