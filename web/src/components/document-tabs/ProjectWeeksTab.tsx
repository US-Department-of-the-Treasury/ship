import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProjectCombobox, Project } from '@/components/ProjectCombobox';
import { cn } from '@/lib/cn';
import type { DocumentTabProps } from '@/lib/document-tabs';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

interface User {
  personId: string;
  id: string | null;
  name: string;
  email: string;
  isArchived?: boolean;
  isPending?: boolean;
}

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface Assignment {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  programId: string | null;
  programName: string | null;
  emoji?: string | null;
  color: string | null;
}

interface TeamGridData {
  users: User[];
  weeks: Week[];
  currentSprintNumber: number;
}

interface ProgramGroup {
  programId: string | null;
  programName: string;
  emoji: string | null;
  color: string | null;
  users: User[];
}

/**
 * ProjectWeeksTab - Shows team allocation for this project
 *
 * Same UI as Team → Allocation, but filtered to show only users
 * who have been allocated to this project.
 */
export default function ProjectWeeksTab({ documentId }: DocumentTabProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<TeamGridData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Record<number, Assignment>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // Fetch all data on mount
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [gridRes, projectsRes, assignmentsRes] = await Promise.all([
          fetch(`${API_URL}/api/team/grid`, { credentials: 'include' }),
          fetch(`${API_URL}/api/team/projects`, { credentials: 'include' }),
          fetch(`${API_URL}/api/team/assignments`, { credentials: 'include' }),
        ]);

        if (!gridRes.ok || !projectsRes.ok || !assignmentsRes.ok) {
          throw new Error('Failed to load team data');
        }

        const gridData: TeamGridData = await gridRes.json();
        const projectsData: Project[] = await projectsRes.json();
        const assignmentsData: Record<string, Record<number, Assignment>> = await assignmentsRes.json();

        setData(gridData);
        setProjects(projectsData);
        setAssignments(assignmentsData);
      } catch (err) {
        setError('Failed to load allocation data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [documentId]);

  // Filter users to only those allocated to this project in any week
  const filteredUsers = useMemo(() => {
    if (!data) return [];

    return data.users.filter((user) => {
      const userAssignments = assignments[user.personId];
      if (!userAssignments) return false;

      return Object.values(userAssignments).some(
        (assignment) => assignment.projectId === documentId
      );
    });
  }, [data, assignments, documentId]);

  // Group filtered users by their current sprint assignment's program
  const programGroups = useMemo((): ProgramGroup[] => {
    if (!data || filteredUsers.length === 0) return [];

    const groups: Map<string, ProgramGroup> = new Map();
    const UNASSIGNED_KEY = '__unassigned__';
    const currentSprintNumber = data.currentSprintNumber;

    for (const user of filteredUsers) {
      const currentAssignment = currentSprintNumber
        ? assignments[user.personId]?.[currentSprintNumber]
        : null;

      const groupKey = currentAssignment?.programId || UNASSIGNED_KEY;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          programId: currentAssignment?.programId || null,
          programName: currentAssignment?.programName || 'Unassigned',
          emoji: currentAssignment?.emoji || null,
          color: currentAssignment?.color || null,
          users: [],
        });
      }

      groups.get(groupKey)!.users.push(user);
    }

    // Sort groups alphabetically, with Unassigned last
    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      if (a.programId === null) return 1;
      if (b.programId === null) return -1;
      return a.programName.localeCompare(b.programName);
    });

    // Sort users within each group alphabetically
    for (const group of sortedGroups) {
      group.users.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sortedGroups;
  }, [data, filteredUsers, assignments]);

  // Scroll to current week on initial load
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current && filteredUsers.length > 0) {
      const currentWeekIndex = data.weeks.findIndex((w) => w.isCurrent);
      if (currentWeekIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 180;
            const scrollPosition = currentWeekIndex * columnWidth;
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data, filteredUsers.length]);

  // Handle assignment
  const handleAssign = useCallback(async (personId: string, projectId: string, sprintNumber: number) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Optimistic update
    const previousAssignment = assignments[personId]?.[sprintNumber];
    setAssignments(prev => ({
      ...prev,
      [personId]: {
        ...prev[personId],
        [sprintNumber]: {
          projectId,
          projectName: project.title,
          projectColor: project.color ?? null,
          programId: project.programId,
          programName: project.programName,
          emoji: project.programEmoji ?? null,
          color: project.programColor ?? null,
        },
      },
    }));

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_URL}/api/team/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        body: JSON.stringify({ personId, projectId, sprintNumber }),
      });

      if (!res.ok) {
        // Rollback
        setAssignments(prev => {
          const newAssignments = { ...prev };
          if (previousAssignment) {
            newAssignments[personId] = { ...newAssignments[personId], [sprintNumber]: previousAssignment };
          } else {
            const { [sprintNumber]: _, ...rest } = newAssignments[personId] || {};
            newAssignments[personId] = rest;
          }
          return newAssignments;
        });
        setError('Failed to assign');
      }
    } catch {
      // Rollback
      setAssignments(prev => {
        const newAssignments = { ...prev };
        if (previousAssignment) {
          newAssignments[personId] = { ...newAssignments[personId], [sprintNumber]: previousAssignment };
        } else {
          const { [sprintNumber]: _, ...rest } = newAssignments[personId] || {};
          newAssignments[personId] = rest;
        }
        return newAssignments;
      });
      setError('Failed to assign user');
    }
  }, [projects, assignments]);

  // Handle unassignment
  const handleUnassign = useCallback(async (personId: string, sprintNumber: number) => {
    const previousAssignment = assignments[personId]?.[sprintNumber];

    // Optimistic update
    setAssignments(prev => {
      const newAssignments = { ...prev };
      if (newAssignments[personId]) {
        const { [sprintNumber]: _, ...rest } = newAssignments[personId];
        newAssignments[personId] = rest;
      }
      return newAssignments;
    });

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_URL}/api/team/assign`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        body: JSON.stringify({ personId, sprintNumber }),
      });

      if (!res.ok) {
        // Rollback
        if (previousAssignment) {
          setAssignments(prev => ({
            ...prev,
            [personId]: { ...prev[personId], [sprintNumber]: previousAssignment },
          }));
        }
        setError('Failed to unassign');
      }
    } catch {
      // Rollback
      if (previousAssignment) {
        setAssignments(prev => ({
          ...prev,
          [personId]: { ...prev[personId], [sprintNumber]: previousAssignment },
        }));
      }
      setError('Failed to unassign user');
    }
  }, [assignments]);

  // Handle cell change
  const handleCellChange = useCallback((personId: string, sprintNumber: number, newProjectId: string | null, currentAssignment: Assignment | null) => {
    if (newProjectId === currentAssignment?.projectId) return;

    if (newProjectId === null && currentAssignment) {
      handleUnassign(personId, sprintNumber);
    } else if (newProjectId) {
      handleAssign(personId, newProjectId, sprintNumber);
    }
  }, [handleAssign, handleUnassign]);

  // Clear error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading allocations...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  // Empty state when no allocations
  if (filteredUsers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
        <p className="text-lg font-medium mb-2">No team allocations</p>
        <p className="text-sm text-center max-w-md">
          Assign team members to this project in Team → Allocation to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Error toast */}
      {error && (
        <div className="absolute right-4 top-4 z-50 rounded-md bg-red-500/90 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {/* Grid container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-20">
        <div className="inline-flex min-w-full">
          {/* Sticky left column - Team members */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-10 w-[180px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Team Member</span>
            </div>

            {/* Program groups with users */}
            {programGroups.map((group) => (
              <div key={group.programId || '__unassigned__'}>
                {/* Program header */}
                <div className="flex h-8 w-[180px] items-center gap-2 border-b border-border bg-border/30 px-3">
                  {group.programId ? (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: group.color || '#6b7280' }}
                    >
                      {group.emoji || group.programName[0]}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white bg-gray-500">
                      ?
                    </span>
                  )}
                  <span className="truncate text-xs font-medium text-foreground">
                    {group.programName}
                  </span>
                  <span className="ml-auto text-[10px] text-muted">
                    {group.users.length}
                  </span>
                </div>

                {/* Users in this group */}
                {group.users.map((user) => (
                  <div
                    key={user.personId}
                    className={cn(
                      'flex h-12 w-[180px] items-center border-b border-border px-3 bg-background',
                      user.isArchived && 'opacity-50',
                      user.isPending && 'opacity-70'
                    )}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div
                        className={cn(
                          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white',
                          user.isArchived ? 'bg-gray-400' : user.isPending ? 'bg-gray-400' : 'bg-accent/80'
                        )}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={cn(
                          'truncate text-sm',
                          user.isArchived ? 'text-muted' : user.isPending ? 'text-muted italic' : 'text-foreground'
                        )}
                      >
                        {user.name}
                        {user.isArchived && <span className="ml-1 text-xs">(archived)</span>}
                        {user.isPending && <span className="ml-1 text-xs font-normal not-italic">(pending)</span>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Week columns */}
          <div className="flex">
            {data?.weeks.map((week) => (
              <div key={week.number} className="flex flex-col">
                {/* Week header */}
                <div
                  className={cn(
                    'flex h-10 w-[180px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
                    week.isCurrent && 'ring-1 ring-inset ring-accent/30'
                  )}
                >
                  <span className={cn('text-xs font-medium', week.isCurrent ? 'text-accent' : 'text-foreground')}>
                    {week.name}
                  </span>
                  <span className="text-[10px] text-muted">
                    {formatDateRange(week.startDate, week.endDate)}
                  </span>
                </div>

                {/* Cells per program group */}
                {programGroups.map((group) => (
                  <div key={group.programId || '__unassigned__'}>
                    {/* Program header spacer */}
                    <div
                      className={cn(
                        'h-8 w-[180px] border-b border-r border-border bg-border/30',
                        week.isCurrent && 'bg-accent/5'
                      )}
                    />

                    {/* User cells for this week */}
                    {group.users.map((user) => {
                      const assignment = assignments[user.personId]?.[week.number];
                      const previousWeekAssignment = assignments[user.personId]?.[week.number - 1];
                      const isPending = user.isPending || !user.id;

                      // Convert previous week assignment to Project format
                      const previousWeekProject: Project | null =
                        previousWeekAssignment?.projectId && previousWeekAssignment?.projectName
                          ? {
                              id: previousWeekAssignment.projectId,
                              title: previousWeekAssignment.projectName,
                              color: previousWeekAssignment.projectColor,
                              programId: previousWeekAssignment.programId,
                              programName: previousWeekAssignment.programName,
                              programEmoji: previousWeekAssignment.emoji,
                              programColor: previousWeekAssignment.color,
                            }
                          : null;

                      return (
                        <div
                          key={user.personId}
                          className={cn(
                            'flex h-12 w-[180px] items-center justify-start border-b border-r border-border px-1',
                            week.isCurrent && 'bg-accent/5',
                            isPending && 'border-dashed'
                          )}
                        >
                          <ProjectCombobox
                            projects={projects}
                            value={assignment?.projectId || null}
                            onChange={(projectId) =>
                              handleCellChange(user.personId, week.number, projectId, assignment || null)
                            }
                            onNavigate={(projectId) => navigate(`/documents/${projectId}`)}
                            placeholder="+"
                            previousWeekProject={previousWeekProject}
                            triggerClassName={cn(
                              'w-full h-full justify-start',
                              !assignment && 'hover:bg-border/30'
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');

  const startMonth = start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const startDay = start.getUTCDate();
  const endMonth = end.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const endDay = end.getUTCDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}
