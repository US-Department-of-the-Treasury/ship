import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { cn, getContrastTextColor } from '@/lib/cn';
import { issueStatusColors, sprintStatusColors } from '@/lib/statusColors';
import { KanbanBoard } from '@/components/KanbanBoard';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { useGlobalListNavigation } from '@/hooks/useGlobalListNavigation';
import { TabBar, Tab as TabItem } from '@/components/ui/TabBar';
import { EmojiPickerPopover } from '@/components/EmojiPicker';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { StandupFeed } from '@/components/StandupFeed';

interface Program {
  id: string;
  name: string;
  description: string | null;
  color: string;
  emoji?: string | null;
  issue_count: number;
  sprint_count: number;
  archived_at: string | null;
}

interface Sprint {
  id: string;
  name: string;
  sprint_number: number;
  owner: { id: string; name: string; email: string } | null;
  issue_count: number;
  completed_count: number;
  started_count: number;
  total_estimate_hours: number;
  has_plan: boolean;
  has_retro: boolean;
  plan_created_at: string | null;
  retro_created_at: string | null;
}

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived?: boolean;
  display_id: string;
  sprint_ref_id: string | null;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

type Tab = 'issues' | 'sprints' | 'settings';

export function ProgramViewPage() {
  const { id, sprintId } = useParams<{ id: string; sprintId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [program, setProgram] = useState<Program | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [showCreateSprintModal, setShowCreateSprintModal] = useState(false);

  // Derive active tab from URL path
  const getActiveTabFromUrl = (): Tab => {
    const path = location.pathname;
    if (path.includes('/sprints')) return 'sprints';
    if (path.includes('/settings')) return 'settings';
    if (path.includes('/issues')) return 'issues';
    // Default to issues for /programs/:id
    return 'issues';
  };

  const activeTab = getActiveTabFromUrl();

  // Get current sprint (from URL param or find the current active sprint)
  const currentSprint = sprintId
    ? sprints.find(s => s.id === sprintId)
    : sprints.find(s => {
        // Find a sprint that is "active" (has started, not ended)
        // For now, just use the first sprint since we don't have date fields
        return true;
      }) || sprints[0];

  // Reset state and fetch data when program ID changes
  useEffect(() => {
    if (!id) return;

    // Reset state for new program
    setProgram(null);
    setIssues([]);
    setSprints([]);
    setLoading(true);

    let cancelled = false;

    async function fetchData() {
      try {
        const [programRes, issuesRes, sprintsRes] = await Promise.all([
          fetch(`${API_URL}/api/programs/${id}`, { credentials: 'include' }),
          fetch(`${API_URL}/api/programs/${id}/issues`, { credentials: 'include' }),
          fetch(`${API_URL}/api/programs/${id}/sprints`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (programRes.ok) {
          setProgram(await programRes.json());
        } else {
          navigate('/programs');
          return;
        }

        if (issuesRes.ok) setIssues(await issuesRes.json());
        if (sprintsRes.ok) {
          const sprintsData = await sprintsRes.json();
          setSprints(sprintsData.sprints || []);
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch program:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const createIssue = async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled', program_id: id }),
      });
      if (res.ok) {
        const issue = await res.json();
        navigate(`/issues/${issue.id}`, { state: { from: 'program', programId: id, programName: program?.name } });
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
  };

  const createSprint = async (data: { name: string; goal: string; start_date: string; end_date: string }) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: data.name, goal: data.goal, start_date: data.start_date, end_date: data.end_date, program_id: id }),
      });
      if (res.ok) {
        const sprint = await res.json();
        setSprints(prev => [sprint, ...prev]);
        setShowCreateSprintModal(false);
      } else {
        const error = await res.json();
        alert(error.error || 'Failed to create sprint');
      }
    } catch (err) {
      console.error('Failed to create sprint:', err);
    }
  };

  const updateIssue = async (issueId: string, updates: { state: string }) => {
    try {
      const res = await fetch(`${API_URL}/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setIssues(prev => prev.map(issue =>
          issue.id === issueId ? { ...issue, ...updates } : issue
        ));
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
  };

  const updateProgram = async (updates: Partial<Program>) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setProgram(prev => prev ? { ...prev, ...updated } : null);
      }
    } catch (err) {
      console.error('Failed to update program:', err);
    }
  };

  const deleteSprint = async (sprintId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/sprints/${sprintId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setSprints(prev => prev.filter(s => s.id !== sprintId));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to delete sprint:', err);
      return false;
    }
  };

  const createSprintDocument = async (sprintId: string, docType: 'sprint_plan' | 'sprint_retro') => {
    try {
      const title = docType === 'sprint_plan' ? 'Sprint Plan' : 'Sprint Retro';
      const res = await fetch(`${API_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          parent_id: sprintId,
          document_type: docType,
        }),
      });
      if (res.ok) {
        const doc = await res.json();
        // Update sprint to reflect new plan/retro
        setSprints(prev => prev.map(s =>
          s.id === sprintId
            ? { ...s, [docType === 'sprint_plan' ? 'has_plan' : 'has_retro']: true }
            : s
        ));
        return doc;
      }
      return null;
    } catch (err) {
      console.error(`Failed to create ${docType}:`, err);
      return null;
    }
  };

  if (loading || !program) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  const tabs: TabItem[] = [
    { id: 'issues', label: 'Issues' },
    { id: 'sprints', label: 'Sprints' },
    { id: 'settings', label: 'Settings' },
  ];

  const renderTabActions = () => {
    if (activeTab === 'issues') {
      return (
        <>
          <div className="flex rounded-md border border-border" role="group" aria-label="View mode">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'list' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <ListIcon aria-hidden="true" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              aria-label="Kanban view"
              aria-pressed={viewMode === 'kanban'}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'kanban' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <KanbanIcon aria-hidden="true" />
            </button>
          </div>
          <button
            onClick={createIssue}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            New Issue
          </button>
        </>
      );
    }
    if (activeTab === 'sprints') {
      return (
        <button
          onClick={() => setShowCreateSprintModal(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          New Sprint
        </button>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumbs Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <button
          onClick={() => navigate('/programs')}
          className="text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white"
          style={{ backgroundColor: program.color }}
        >
          {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{program.name}</h1>
        </div>
      </div>

      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => {
          if (tabId === 'issues') {
            navigate(`/programs/${id}/issues`);
          } else if (tabId === 'sprints') {
            navigate(`/programs/${id}/sprints`);
          } else if (tabId === 'settings') {
            navigate(`/programs/${id}/settings`);
          }
        }}
        rightContent={renderTabActions()}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'issues' && (
          viewMode === 'kanban' ? (
            <KanbanBoard
              issues={issues}
              onUpdateIssue={updateIssue}
              onIssueClick={(issueId) => navigate(`/issues/${issueId}`, { state: { from: 'program', programId: id, programName: program?.name } })}
            />
          ) : (
            <IssuesList
              issues={issues}
              onIssueClick={(issueId) => navigate(`/issues/${issueId}`, { state: { from: 'program', programId: id, programName: program?.name } })}
            />
          )
        )}

        {activeTab === 'sprints' && (
          <div className="flex h-full">
            {/* Left side: Sprint list or Sprint detail with issues */}
            <div className="flex-1 overflow-auto border-r border-border">
              {sprintId && currentSprint ? (
                <SprintDetailView
                  sprint={currentSprint}
                  issues={issues.filter(i => i.sprint_ref_id === sprintId)}
                  onIssueClick={(issueId) => navigate(`/issues/${issueId}`, { state: { from: 'program', programId: id, programName: program?.name } })}
                  onBack={() => navigate(`/programs/${id}/sprints`)}
                />
              ) : (
                <SprintsList
                  sprints={sprints}
                  onSprintClick={(clickedSprintId) => navigate(`/programs/${id}/sprints/${clickedSprintId}`)}
                  onDeleteSprint={deleteSprint}
                  onCreatePlan={async (clickedSprintId) => {
                    const doc = await createSprintDocument(clickedSprintId, 'sprint_plan');
                    if (doc) navigate(`/docs/${doc.id}`);
                  }}
                  onCreateRetro={async (clickedSprintId) => {
                    const doc = await createSprintDocument(clickedSprintId, 'sprint_retro');
                    if (doc) navigate(`/docs/${doc.id}`);
                  }}
                  onViewPlan={(clickedSprintId) => navigate(`/sprints/${clickedSprintId}/plan`)}
                  onViewRetro={(clickedSprintId) => navigate(`/sprints/${clickedSprintId}/retro`)}
                />
              )}
            </div>
            {/* Right side: Standup feed (only shown when viewing a specific sprint) */}
            {sprintId && currentSprint && (
              <div className="w-96 flex-shrink-0 overflow-hidden">
                <StandupFeed sprintId={sprintId} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <ProgramSettings program={program} onUpdate={updateProgram} />
        )}
      </div>

      {showCreateSprintModal && (
        <CreateSprintModal
          onClose={() => setShowCreateSprintModal(false)}
          onCreate={createSprint}
        />
      )}
    </div>
  );
}


function IssuesList({ issues, onIssueClick }: { issues: Issue[]; onIssueClick: (id: string) => void }) {
  const stateLabels: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    done: 'Done',
    cancelled: 'Cancelled',
  };

  // Track selection for keyboard navigation
  const selectionRef = useRef<UseSelectionReturn | null>(null);
  const [, forceUpdate] = useState(0);

  const handleSelectionChange = useCallback((_selectedIds: Set<string>, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
    forceUpdate(n => n + 1);
  }, []);

  // Global keyboard navigation for j/k and Enter
  useGlobalListNavigation({
    selection: selectionRef.current,
    enabled: true,
    onEnter: useCallback((focusedId: string) => {
      onIssueClick(focusedId);
    }, [onIssueClick]),
  });

  const columns = [
    { key: 'id', label: 'ID', className: 'w-24' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status', className: 'w-32' },
    { key: 'assignee', label: 'Assignee', className: 'w-40' },
  ];

  const renderRow = (issue: Issue, { isSelected, isFocused }: RowRenderProps) => (
    <>
      <td className="px-4 py-3 text-sm font-mono text-muted">
        {issue.display_id}
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {issue.title}
      </td>
      <td className="px-4 py-3">
        <span className={cn('rounded px-2 py-0.5 text-xs font-medium', issueStatusColors[issue.state])}>
          {stateLabels[issue.state] || issue.state}
        </span>
      </td>
      <td className={cn("px-4 py-3 text-sm text-muted", issue.assignee_archived && "opacity-50")}>
        {issue.assignee_name ? (
          <>
            {issue.assignee_name}{issue.assignee_archived && ' (archived)'}
          </>
        ) : 'Unassigned'}
      </td>
    </>
  );

  return (
    <SelectableList
      items={issues}
      loading={false}
      emptyState={<p className="text-muted">No issues in this program</p>}
      renderRow={renderRow}
      selectable={true}
      onSelectionChange={handleSelectionChange}
      onItemClick={(issue) => onIssueClick(issue.id)}
      columns={columns}
      ariaLabel="Program issues"
    />
  );
}

function SprintsList({
  sprints,
  onSprintClick,
  onDeleteSprint,
  onCreatePlan,
  onCreateRetro,
  onViewPlan,
  onViewRetro,
}: {
  sprints: Sprint[];
  onSprintClick: (id: string) => void;
  onDeleteSprint: (id: string) => Promise<boolean>;
  onCreatePlan: (id: string) => Promise<void>;
  onCreateRetro: (id: string) => Promise<void>;
  onViewPlan: (id: string) => void;
  onViewRetro: (id: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sprint: Sprint } | null>(null);
  const { showToast } = useToast();

  const handleContextMenu = (e: React.MouseEvent, sprint: Sprint) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, sprint });
  };

  const handleMenuClick = (e: React.MouseEvent, sprint: Sprint) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, sprint });
  };

  const handleDelete = async (sprint: Sprint) => {
    const success = await onDeleteSprint(sprint.id);
    if (success) {
      showToast('Sprint deleted', 'success');
    }
    setContextMenu(null);
  };

  if (!sprints || sprints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">No sprints in this program</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {sprints.map((sprint) => {
        const progress = sprint.issue_count > 0
          ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
          : 0;

        return (
          <div
            key={sprint.id}
            className="group relative rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-border/30 cursor-pointer"
            onContextMenu={(e) => handleContextMenu(e, sprint)}
            onClick={() => onSprintClick(sprint.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-medium text-foreground">{sprint.name}</h3>
                {sprint.owner && (
                  <span className="text-sm text-muted">{sprint.owner.name}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-muted">
                  {sprint.has_plan && <span className="text-green-500">● Plan</span>}
                  {sprint.has_retro && <span className="text-green-500">● Retro</span>}
                </div>
                {/* Three-dot menu button */}
                <button
                  type="button"
                  onClick={(e) => handleMenuClick(e, sprint)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-border/50 text-muted hover:text-foreground transition-opacity"
                  aria-label={`More actions for ${sprint.name}`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted">
                {sprint.completed_count}/{sprint.issue_count} done
              </span>
            </div>
          </div>
        );
      })}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          {contextMenu.sprint.has_plan ? (
            <ContextMenuItem
              onClick={() => {
                onViewPlan(contextMenu.sprint.id);
                setContextMenu(null);
              }}
            >
              <DocumentIcon />
              View Sprint Plan
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={async () => {
                await onCreatePlan(contextMenu.sprint.id);
                setContextMenu(null);
              }}
            >
              <PlusIcon />
              Create Sprint Plan
            </ContextMenuItem>
          )}
          {contextMenu.sprint.has_retro ? (
            <ContextMenuItem
              onClick={() => {
                onViewRetro(contextMenu.sprint.id);
                setContextMenu(null);
              }}
            >
              <DocumentIcon />
              View Sprint Retro
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={async () => {
                await onCreateRetro(contextMenu.sprint.id);
                setContextMenu(null);
              }}
            >
              <PlusIcon />
              Create Sprint Retro
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onClick={() => handleDelete(contextMenu.sprint)}
          >
            <TrashIcon />
            Delete Sprint
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

function SprintDetailView({
  sprint,
  issues,
  onIssueClick,
  onBack,
}: {
  sprint: Sprint;
  issues: Issue[];
  onIssueClick: (id: string) => void;
  onBack: () => void;
}) {
  const stateLabels: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    done: 'Done',
    cancelled: 'Cancelled',
  };

  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Sprint header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="font-semibold text-foreground">{sprint.name}</h2>
            {sprint.owner && (
              <p className="text-sm text-muted">{sprint.owner.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted">
            {sprint.completed_count}/{sprint.issue_count} done
          </span>
        </div>
      </div>

      {/* Issues list */}
      <div className="flex-1 overflow-auto">
        {issues.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted">No issues in this sprint</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider w-24">ID</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider">Title</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider w-32">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider w-40">Assignee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  className="hover:bg-border/30 cursor-pointer transition-colors"
                  onClick={() => onIssueClick(issue.id)}
                >
                  <td className="px-4 py-3 text-sm font-mono text-muted">
                    {issue.display_id}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {issue.title}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded px-2 py-0.5 text-xs font-medium', issueStatusColors[issue.state])}>
                      {stateLabels[issue.state] || issue.state}
                    </span>
                  </td>
                  <td className={cn("px-4 py-3 text-sm text-muted", issue.assignee_archived && "opacity-50")}>
                    {issue.assignee_name ? (
                      <>
                        {issue.assignee_name}{issue.assignee_archived && ' (archived)'}
                      </>
                    ) : 'Unassigned'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function DocumentIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ProgramSettings({ program, onUpdate }: { program: Program; onUpdate: (updates: Partial<Program>) => void }) {
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description || '');

  const handleSave = () => {
    onUpdate({ name, description: description || null });
  };

  const handleEmojiChange = (emoji: string | null) => {
    onUpdate({ emoji });
  };

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium text-muted">Icon</label>
        <EmojiPickerPopover value={program.emoji} onChange={handleEmojiChange}>
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg text-xl cursor-pointer hover:ring-2 hover:ring-accent transition-all"
            style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
          >
            {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
          </div>
        </EmojiPickerPopover>
        <p className="mt-1 text-xs text-muted">Click to change emoji</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-muted">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-muted">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <button
        onClick={handleSave}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
      >
        Save Changes
      </button>
    </div>
  );
}

function CreateSprintModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { name: string; goal: string; start_date: string; end_date: string }) => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeksLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(twoWeeksLater);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), goal: goal.trim(), start_date: startDate, end_date: endDate });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6">
        <h2 className="text-lg font-semibold text-foreground">Create Sprint</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Goal (optional)</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What should we accomplish this sprint?"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Sprint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ListIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}
