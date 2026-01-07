import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ProgramCombobox, Program } from '@/components/ProgramCombobox';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? '';

type TeamTab = 'assignments' | 'accountability';

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

interface Assignment {
  programId: string;
  programName: string;
  emoji?: string | null;
  color: string;
  sprintDocId: string;
}

interface TeamGridData {
  users: User[];
  sprints: Sprint[];
  currentSprintNumber: number;
}

const SPRINTS_PER_LOAD = 5;
const SCROLL_THRESHOLD = 200;

export function TeamModePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TeamTab>(
    (searchParams.get('tab') as TeamTab) || 'assignments'
  );
  const [data, setData] = useState<TeamGridData | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Record<number, Assignment>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<'left' | 'right' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sprintRange, setSprintRange] = useState<{ min: number; max: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  const handleTabChange = (tab: TeamTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Dialog states
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
    sprintNumber: number;
    sprintName: string;
    currentProgram: Assignment | null;
    newProgramId: string | null;
    newProgram: Program | null;
  } | null>(null);
  const [lastPersonDialog, setLastPersonDialog] = useState<{
    open: boolean;
    userId: string;
    sprintNumber: number;
    issuesOrphaned: Array<{ id: string; title: string }>;
    onConfirm: () => void;
  } | null>(null);
  const [operationLoading, setOperationLoading] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    Promise.all([
      fetchTeamGrid(),
      fetchPrograms(),
      fetchAssignments(),
    ]).finally(() => setLoading(false));
  }, []);

  // Scroll to current sprint on initial load
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentSprintIndex = data.sprints.findIndex(s => s.isCurrent);
      if (currentSprintIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 140;
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

      if (json.sprints.length > 0) {
        setSprintRange({
          min: json.sprints[0].number,
          max: json.sprints[json.sprints.length - 1].number,
        });
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function fetchPrograms() {
    try {
      const res = await fetch(`${API_URL}/api/team/programs`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setPrograms(json);
      }
    } catch (err) {
      console.error('Failed to fetch programs:', err);
    }
  }

  async function fetchAssignments() {
    try {
      const res = await fetch(`${API_URL}/api/team/assignments`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setAssignments(json);
      }
    } catch (err) {
      console.error('Failed to fetch assignments:', err);
    }
  }

  const handleAssign = async (userId: string, programId: string, sprintNumber: number) => {
    const cellKey = `${userId}-${sprintNumber}`;
    setOperationLoading(cellKey);

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_URL}/api/team/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        body: JSON.stringify({ userId, programId, sprintNumber }),
      });

      const json = await res.json();

      if (res.status === 409) {
        // User already assigned to another program - show confirmation
        setError(`User already assigned to ${json.existingProgramName} for this sprint`);
        return;
      }

      if (!res.ok) {
        setError(json.error || 'Failed to assign');
        return;
      }

      // Update local state optimistically
      const program = programs.find(p => p.id === programId);
      if (program) {
        setAssignments(prev => ({
          ...prev,
          [userId]: {
            ...prev[userId],
            [sprintNumber]: {
              programId,
              programName: program.name,
              emoji: program.emoji,
              color: program.color,
              sprintDocId: json.sprintId,
            },
          },
        }));
      }
    } catch (err) {
      setError('Failed to assign user');
    } finally {
      setOperationLoading(null);
    }
  };

  const handleUnassign = async (userId: string, sprintNumber: number, skipConfirmation = false) => {
    const cellKey = `${userId}-${sprintNumber}`;
    setOperationLoading(cellKey);

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_URL}/api/team/assign`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        body: JSON.stringify({ userId, sprintNumber }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Failed to unassign');
        return;
      }

      // If there were orphaned issues, show them in a dialog (unless skipped)
      if (json.issuesOrphaned?.length > 0 && !skipConfirmation) {
        // Issues were already moved to backlog, just inform the user
        console.log(`${json.issuesOrphaned.length} issues moved to backlog`);
      }

      // Update local state
      setAssignments(prev => {
        const newAssignments = { ...prev };
        if (newAssignments[userId]) {
          const { [sprintNumber]: _, ...rest } = newAssignments[userId];
          newAssignments[userId] = rest;
        }
        return newAssignments;
      });
    } catch (err) {
      setError('Failed to unassign user');
    } finally {
      setOperationLoading(null);
    }
  };

  const handleCellChange = useCallback((
    userId: string,
    userName: string,
    sprintNumber: number,
    sprintName: string,
    newProgramId: string | null,
    currentAssignment: Assignment | null
  ) => {
    // Same program - no change
    if (newProgramId === currentAssignment?.programId) {
      return;
    }

    // Clear assignment
    if (newProgramId === null && currentAssignment) {
      handleUnassign(userId, sprintNumber);
      return;
    }

    // New assignment (no existing)
    if (newProgramId && !currentAssignment) {
      handleAssign(userId, newProgramId, sprintNumber);
      return;
    }

    // Reassignment - show confirmation dialog
    if (newProgramId && currentAssignment) {
      const newProgram = programs.find(p => p.id === newProgramId) || null;
      setConfirmDialog({
        open: true,
        userId,
        userName,
        sprintNumber,
        sprintName,
        currentProgram: currentAssignment,
        newProgramId,
        newProgram,
      });
    }
  }, [programs]);

  const handleConfirmReassign = async () => {
    if (!confirmDialog) return;

    const { userId, sprintNumber, newProgramId } = confirmDialog;
    setConfirmDialog(null);

    if (!newProgramId) return;

    // First unassign from current program
    await handleUnassign(userId, sprintNumber, true);
    // Then assign to new program
    await handleAssign(userId, newProgramId, sprintNumber);
  };

  // Fetch more sprints
  const fetchMoreSprints = useCallback(async (direction: 'left' | 'right') => {
    if (!data || !sprintRange || loadingMore) return;

    const fromSprint = direction === 'left'
      ? Math.max(1, sprintRange.min - SPRINTS_PER_LOAD)
      : sprintRange.max + 1;
    const toSprint = direction === 'left'
      ? sprintRange.min - 1
      : sprintRange.max + SPRINTS_PER_LOAD;

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

      const scrollContainer = scrollContainerRef.current;
      const prevScrollLeft = scrollContainer?.scrollLeft || 0;
      const prevScrollWidth = scrollContainer?.scrollWidth || 0;

      setData(prev => {
        if (!prev) return newData;
        const mergedSprints = direction === 'left'
          ? [...newData.sprints, ...prev.sprints]
          : [...prev.sprints, ...newData.sprints];
        return { ...prev, sprints: mergedSprints };
      });

      setSprintRange(prev => {
        if (!prev) return { min: fromSprint, max: toSprint };
        return {
          min: direction === 'left' ? fromSprint : prev.min,
          max: direction === 'right' ? toSprint : prev.max,
        };
      });

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

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;

    if (scrollLeft < SCROLL_THRESHOLD && sprintRange && sprintRange.min > 1) {
      fetchMoreSprints('left');
    }

    if (scrollWidth - scrollLeft - clientWidth < SCROLL_THRESHOLD) {
      fetchMoreSprints('right');
    }
  }, [fetchMoreSprints, loadingMore, sprintRange]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

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
        <div className="text-muted">Loading team grid...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">{error || 'Failed to load data'}</div>
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

      {/* Header with Tabs */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-medium text-foreground">Teams</h1>
          <div className="flex gap-1">
            <button
              onClick={() => handleTabChange('assignments')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                activeTab === 'assignments'
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-foreground hover:bg-border/50'
              )}
            >
              Assignments
            </button>
            <button
              onClick={() => handleTabChange('accountability')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                activeTab === 'accountability'
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-foreground hover:bg-border/50'
              )}
            >
              Accountability
            </button>
          </div>
        </div>
        <span className="text-xs text-muted">
          {data.users.length} team members &middot; {programs.length} programs
        </span>
      </header>

      {/* Tab Content */}
      {activeTab === 'accountability' ? (
        <AccountabilityTable />
      ) : (
        /* Assignments Grid container */
        <div className="flex flex-1 overflow-hidden">
          {/* Fixed user column */}
          <div className="flex flex-col border-r border-border bg-background">
          <div className="flex h-[41.5px] w-[180px] items-center justify-center border-b border-border px-3">
            <span className="text-xs font-medium text-muted">Team Member</span>
          </div>
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
                  const assignment = assignments[user.id]?.[sprint.number];
                  const cellKey = `${user.id}-${sprint.number}`;
                  const isLoading = operationLoading === cellKey;

                  return (
                    <SprintCell
                      key={cellKey}
                      assignment={assignment}
                      programs={programs}
                      isCurrent={sprint.isCurrent}
                      loading={isLoading}
                      onChange={(programId) =>
                        handleCellChange(
                          user.id,
                          user.name,
                          sprint.number,
                          sprint.name,
                          programId,
                          assignment || null
                        )
                      }
                      onNavigate={(programId) => navigate(`/programs/${programId}`)}
                    />
                  );
                })}
              </div>
            ))}

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
      )}

      {/* Confirmation Dialog for Reassignment */}
      <Dialog.Root open={confirmDialog?.open || false} onOpenChange={(open: boolean) => !open && setConfirmDialog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Reassign {confirmDialog?.userName}?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              {confirmDialog?.userName} is currently assigned to{' '}
              <span className="font-medium text-foreground">{confirmDialog?.currentProgram?.programName}</span>
              {' '}for {confirmDialog?.sprintName}.
            </Dialog.Description>

            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-muted">Change to:</span>
              <span
                className="rounded px-1.5 py-0.5 text-xs font-bold text-white"
                style={{ backgroundColor: confirmDialog?.newProgram?.color || '#666' }}
              >
                {confirmDialog?.newProgram?.emoji || confirmDialog?.newProgram?.name?.[0]}
              </span>
              <span className="text-sm text-foreground">{confirmDialog?.newProgram?.name}</span>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close asChild>
                <button className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                onClick={handleConfirmReassign}
                className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90"
              >
                Confirm Reassignment
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Last Person Dialog */}
      <Dialog.Root open={lastPersonDialog?.open || false} onOpenChange={(open: boolean) => !open && setLastPersonDialog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Remove Last Assignee
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              This is the last person assigned to this sprint. Removing them will delete the sprint document.
            </Dialog.Description>

            {lastPersonDialog?.issuesOrphaned && lastPersonDialog.issuesOrphaned.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-foreground">
                  {lastPersonDialog.issuesOrphaned.length} issues will be moved to backlog:
                </p>
                <ul className="mt-2 max-h-[150px] overflow-auto rounded border border-border p-2">
                  {lastPersonDialog.issuesOrphaned.map((issue) => (
                    <li key={issue.id} className="text-sm text-muted truncate">
                      {issue.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close asChild>
                <button className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                onClick={() => {
                  lastPersonDialog?.onConfirm();
                  setLastPersonDialog(null);
                }}
                className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                Remove & Delete Sprint
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SprintCell({
  assignment,
  programs,
  isCurrent,
  loading,
  onChange,
  onNavigate,
}: {
  assignment?: Assignment;
  programs: Program[];
  isCurrent: boolean;
  loading: boolean;
  onChange: (programId: string | null) => void;
  onNavigate: (programId: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex h-12 w-[140px] items-center justify-start border-b border-r border-border px-1',
        isCurrent && 'bg-accent/5',
        loading && 'animate-pulse'
      )}
    >
      <ProgramCombobox
        programs={programs}
        value={assignment?.programId || null}
        onChange={onChange}
        onNavigate={onNavigate}
        disabled={loading}
        placeholder="+"
        triggerClassName={cn(
          'w-full h-full justify-start',
          !assignment && 'hover:bg-border/30'
        )}
      />
    </div>
  );
}

function formatDateRange(startDate: string, endDate: string): string {
  // Parse as UTC to avoid timezone issues with YYYY-MM-DD format
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

// Accountability Table Component - shows sprint completion metrics per person
interface AccountabilitySprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface AccountabilityPerson {
  id: string;
  name: string;
}

interface AccountabilityMetrics {
  committed: number;
  completed: number;
}

interface PatternAlert {
  hasAlert: boolean;
  consecutiveCount: number;
  trend: number[]; // -1 means no data for that sprint
}

function AccountabilityTable() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<AccountabilityPerson[]>([]);
  const [sprints, setSprints] = useState<AccountabilitySprint[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Record<number, AccountabilityMetrics>>>({});
  const [patternAlerts, setPatternAlerts] = useState<Record<string, PatternAlert>>({});

  useEffect(() => {
    async function fetchAccountability() {
      try {
        const res = await fetch(`${API_URL}/api/team/accountability`, { credentials: 'include' });
        if (!res.ok) {
          if (res.status === 403) {
            setError('Admin access required to view accountability metrics');
          } else {
            setError('Failed to load accountability data');
          }
          return;
        }
        const data = await res.json();
        setPeople(data.people);
        setSprints(data.sprints);
        setMetrics(data.metrics);
        setPatternAlerts(data.patternAlerts || {});
      } catch (err) {
        setError('Failed to load accountability data');
      } finally {
        setLoading(false);
      }
    }

    fetchAccountability();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted">Loading accountability data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-red-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 bg-background border-b border-r border-border px-4 py-2 text-left text-xs font-medium text-muted w-[180px]">
              Team Member
            </th>
            {sprints.map((sprint) => (
              <th
                key={sprint.number}
                className={cn(
                  'sticky top-0 z-10 bg-background border-b border-r border-border px-3 py-2 text-center text-xs font-medium min-w-[100px]',
                  sprint.isCurrent ? 'text-accent' : 'text-muted'
                )}
              >
                <div>{sprint.name}</div>
                <div className="text-[10px] font-normal">
                  {formatDateRange(sprint.startDate, sprint.endDate)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const alert = patternAlerts[person.id];
            const hasPatternAlert = alert?.hasAlert;
            const trendString = alert?.trend
              .map(t => t === -1 ? '-' : `${t}%`)
              .join(' → ');

            return (
            <tr key={person.id}>
              <td className="sticky left-0 z-10 bg-background border-b border-r border-border px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white">
                    {person.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-sm text-foreground">{person.name}</span>
                  {hasPatternAlert && (
                    <span
                      className="ml-1 text-orange-500 cursor-help"
                      title={`⚠️ Low completion pattern: ${alert.consecutiveCount} consecutive sprints below 60%\nTrend: ${trendString}`}
                    >
                      ⚠
                    </span>
                  )}
                </div>
              </td>
              {sprints.map((sprint) => {
                const cellMetrics = metrics[person.id]?.[sprint.number];
                const committed = cellMetrics?.committed || 0;
                const completed = cellMetrics?.completed || 0;
                const percentage = committed > 0 ? Math.round((completed / committed) * 100) : null;
                const isLow = percentage !== null && percentage < 60;

                return (
                  <td
                    key={sprint.number}
                    className={cn(
                      'border-b border-r border-border px-3 py-2 text-center text-sm',
                      sprint.isCurrent && 'bg-accent/5',
                      isLow && 'bg-red-500/10'
                    )}
                  >
                    {committed > 0 ? (
                      <div className="flex flex-col items-center">
                        <span className={cn(
                          'font-medium',
                          isLow ? 'text-red-500' : 'text-foreground'
                        )}>
                          {completed}/{committed}
                        </span>
                        <span className={cn(
                          'text-xs',
                          isLow ? 'text-red-400' : 'text-muted'
                        )}>
                          {percentage}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
          })}
        </tbody>
      </table>
    </div>
  );
}
