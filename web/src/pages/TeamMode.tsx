import { useState, useEffect, useRef, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface User {
  id: string;
  name: string;
  email: string;
}

interface Sprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface ProjectAssociation {
  id: string;
  name: string;
  prefix: string;
  color: string;
  issueCount: number;
}

interface IssueAssociation {
  id: string;
  title: string;
  displayId: string;
  state: string;
}

interface CellData {
  projects: ProjectAssociation[];
  issues: IssueAssociation[];
}

interface TeamGridData {
  users: User[];
  sprints: Sprint[];
  associations: Record<string, Record<number, CellData>>;
  currentSprintNumber: number;
}

const SPRINTS_PER_LOAD = 5; // How many sprints to load when scrolling
const SCROLL_THRESHOLD = 200; // Pixels from edge to trigger load

export function TeamModePage() {
  const [data, setData] = useState<TeamGridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<'left' | 'right' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sprintRange, setSprintRange] = useState<{ min: number; max: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // Initial load
  useEffect(() => {
    fetchTeamGrid();
  }, []);

  // Scroll to current sprint on initial load
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentSprintIndex = data.sprints.findIndex(s => s.isCurrent);
      if (currentSprintIndex >= 0) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 140;
            // Position current sprint at the left edge (show one previous sprint for context)
            const scrollPosition = Math.max(0, (currentSprintIndex - 1) * columnWidth);
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data]);

  async function fetchTeamGrid(fromSprint?: number, toSprint?: number) {
    try {
      const params = new URLSearchParams();
      if (fromSprint !== undefined) params.set('fromSprint', String(fromSprint));
      if (toSprint !== undefined) params.set('toSprint', String(toSprint));

      const url = `${API_URL}/api/team/grid${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch team grid');
      const json: TeamGridData = await res.json();

      // Set initial sprint range
      if (json.sprints.length > 0) {
        setSprintRange({
          min: json.sprints[0].number,
          max: json.sprints[json.sprints.length - 1].number,
        });
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // Fetch more sprints (left or right)
  const fetchMoreSprints = useCallback(async (direction: 'left' | 'right') => {
    if (!data || !sprintRange || loadingMore) return;

    const fromSprint = direction === 'left'
      ? Math.max(1, sprintRange.min - SPRINTS_PER_LOAD)
      : sprintRange.max + 1;
    const toSprint = direction === 'left'
      ? sprintRange.min - 1
      : sprintRange.max + SPRINTS_PER_LOAD;

    // Don't load if we're at sprint 1 going left
    if (direction === 'left' && sprintRange.min <= 1) return;

    setLoadingMore(direction);

    try {
      const params = new URLSearchParams({
        fromSprint: String(fromSprint),
        toSprint: String(toSprint),
      });

      const res = await fetch(`${API_URL}/api/team/grid?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch more sprints');
      const newData: TeamGridData = await res.json();

      // Store current scroll position for left-loading
      const scrollContainer = scrollContainerRef.current;
      const prevScrollLeft = scrollContainer?.scrollLeft || 0;
      const prevScrollWidth = scrollContainer?.scrollWidth || 0;

      // Merge data
      setData(prev => {
        if (!prev) return newData;

        const mergedSprints = direction === 'left'
          ? [...newData.sprints, ...prev.sprints]
          : [...prev.sprints, ...newData.sprints];

        // Merge associations
        const mergedAssociations = { ...prev.associations };
        for (const [userId, userSprints] of Object.entries(newData.associations)) {
          if (!mergedAssociations[userId]) {
            mergedAssociations[userId] = {};
          }
          for (const [sprintNum, cellData] of Object.entries(userSprints)) {
            mergedAssociations[userId][Number(sprintNum)] = cellData;
          }
        }

        return {
          ...prev,
          sprints: mergedSprints,
          associations: mergedAssociations,
        };
      });

      // Update range
      setSprintRange(prev => {
        if (!prev) return { min: fromSprint, max: toSprint };
        return {
          min: direction === 'left' ? fromSprint : prev.min,
          max: direction === 'right' ? toSprint : prev.max,
        };
      });

      // Adjust scroll position when prepending (left load)
      if (direction === 'left' && scrollContainer) {
        requestAnimationFrame(() => {
          const newScrollWidth = scrollContainer.scrollWidth;
          const addedWidth = newScrollWidth - prevScrollWidth;
          scrollContainer.scrollLeft = prevScrollLeft + addedWidth;
        });
      }
    } catch (err) {
      console.error('Error loading more sprints:', err);
    } finally {
      setLoadingMore(null);
    }
  }, [data, sprintRange, loadingMore]);

  // Handle scroll to detect when near edges
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;

    // Check if near left edge
    if (scrollLeft < SCROLL_THRESHOLD && sprintRange && sprintRange.min > 1) {
      fetchMoreSprints('left');
    }

    // Check if near right edge
    if (scrollWidth - scrollLeft - clientWidth < SCROLL_THRESHOLD) {
      fetchMoreSprints('right');
    }
  }, [fetchMoreSprints, loadingMore, sprintRange]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading team grid...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-medium text-foreground">Teams</h1>
        <span className="text-xs text-muted">
          {data.users.length} team members
        </span>
      </header>

      {/* Grid container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed user column */}
        <div className="flex flex-col border-r border-border bg-background">
          {/* Header cell */}
          <div className="flex h-10 w-[180px] items-center justify-center border-b border-border px-3">
            <span className="text-xs font-medium text-muted">Team Member</span>
          </div>
          {/* User rows */}
          {data.users.map((user) => (
            <div
              key={user.id}
              className="flex h-12 w-[180px] items-center border-b border-border px-3"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="truncate text-sm text-foreground">{user.name}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable sprint columns */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div className="inline-flex items-start">
            {/* Loading indicator for left */}
            {loadingMore === 'left' && (
              <div className="flex h-full w-[60px] flex-col items-center justify-center">
                <div className="h-10 flex items-center justify-center border-b border-border">
                  <span className="text-xs text-muted animate-pulse">...</span>
                </div>
              </div>
            )}

            {data.sprints.map((sprint) => (
              <div key={sprint.number} className="flex flex-col">
                {/* Sprint header */}
                <div
                  className={cn(
                    'flex h-10 w-[140px] flex-col items-center justify-center border-b border-r border-border px-2',
                    sprint.isCurrent && 'bg-accent/10'
                  )}
                >
                  <span className={cn(
                    'text-xs font-medium',
                    sprint.isCurrent ? 'text-accent' : 'text-foreground'
                  )}>
                    {sprint.name}
                  </span>
                  <span className="text-[10px] text-muted">
                    {formatDateRange(sprint.startDate, sprint.endDate)}
                  </span>
                </div>

                {/* Sprint cells for each user */}
                {data.users.map((user) => {
                  const cellData = data.associations[user.id]?.[sprint.number];
                  return (
                    <SprintCell
                      key={`${user.id}-${sprint.number}`}
                      cellData={cellData}
                      isCurrent={sprint.isCurrent}
                      userName={user.name}
                      sprintName={sprint.name}
                    />
                  );
                })}
              </div>
            ))}

            {/* Loading indicator for right */}
            {loadingMore === 'right' && (
              <div className="flex h-full w-[60px] flex-col items-center justify-center">
                <div className="h-10 flex items-center justify-center border-b border-border">
                  <span className="text-xs text-muted animate-pulse">...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SprintCell({
  cellData,
  isCurrent,
  userName,
  sprintName,
}: {
  cellData?: CellData;
  isCurrent: boolean;
  userName: string;
  sprintName: string;
}) {
  const [open, setOpen] = useState(false);

  if (!cellData || cellData.projects.length === 0) {
    return (
      <div
        className={cn(
          'flex h-12 w-[140px] items-center justify-center border-b border-r border-border',
          isCurrent && 'bg-accent/5'
        )}
      />
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn(
            'flex h-12 w-[140px] items-center gap-1 border-b border-r border-border px-2 transition-colors',
            isCurrent ? 'bg-accent/5 hover:bg-accent/10' : 'hover:bg-border/30'
          )}
        >
          {cellData.projects.slice(0, 3).map((project) => (
            <span
              key={project.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: project.color }}
              title={`${project.name} (${project.issueCount} issues)`}
            >
              {project.prefix}
            </span>
          ))}
          {cellData.projects.length > 3 && (
            <span className="text-[10px] text-muted">
              +{cellData.projects.length - 3}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[280px] rounded-md border border-border bg-background p-3 shadow-lg"
          sideOffset={4}
          align="start"
        >
          <div className="mb-2 border-b border-border pb-2">
            <div className="text-xs font-medium text-foreground">{userName}</div>
            <div className="text-[10px] text-muted">{sprintName}</div>
          </div>

          <div className="space-y-3">
            {cellData.projects.map((project) => (
              <div key={project.id}>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: project.color }}
                  >
                    {project.prefix}
                  </span>
                  <span className="text-xs text-foreground">{project.name}</span>
                  <span className="text-[10px] text-muted">
                    ({project.issueCount} {project.issueCount === 1 ? 'issue' : 'issues'})
                  </span>
                </div>

                <ul className="space-y-1 pl-2">
                  {cellData.issues
                    .filter((issue) => issue.displayId.startsWith(project.prefix))
                    .map((issue) => (
                      <li key={issue.id} className="flex items-center gap-2 text-xs">
                        <span className={cn(
                          'h-1.5 w-1.5 rounded-full flex-shrink-0',
                          issue.state === 'done' ? 'bg-green-500' :
                          issue.state === 'in_progress' ? 'bg-yellow-500' :
                          issue.state === 'todo' ? 'bg-blue-500' :
                          'bg-gray-500'
                        )} />
                        <span className="font-mono text-[10px] text-muted">{issue.displayId}</span>
                        <span className="truncate text-muted">{issue.title}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>

          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const startDay = start.getDate();
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const endDay = end.getDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}
