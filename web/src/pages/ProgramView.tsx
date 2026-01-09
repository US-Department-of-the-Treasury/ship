import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn, getContrastTextColor } from '@/lib/cn';
import { issueStatusColors, sprintStatusColors } from '@/lib/statusColors';
import { KanbanBoard } from '@/components/KanbanBoard';
import { TabBar, Tab as TabItem } from '@/components/ui/TabBar';
import { EmojiPickerPopover } from '@/components/EmojiPicker';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';

interface GitHubRepo {
  owner: string;
  repo: string;
}

interface Program {
  id: string;
  name: string;
  description: string | null;
  color: string;
  emoji?: string | null;
  github_repos?: GitHubRepo[];
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [program, setProgram] = useState<Program | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('issues');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [showCreateSprintModal, setShowCreateSprintModal] = useState(false);

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
        navigate(`/issues/${issue.id}`);
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
        onTabChange={(tabId) => setActiveTab(tabId as Tab)}
        rightContent={renderTabActions()}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'issues' && (
          viewMode === 'kanban' ? (
            <KanbanBoard
              issues={issues}
              onUpdateIssue={updateIssue}
              onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
            />
          ) : (
            <IssuesList issues={issues} onIssueClick={(issueId) => navigate(`/issues/${issueId}`)} />
          )
        )}

        {activeTab === 'sprints' && (
          <SprintsList
            sprints={sprints}
            onSprintClick={(sprintId) => navigate(`/sprints/${sprintId}/view`)}
            onDeleteSprint={deleteSprint}
            onCreatePlan={async (sprintId) => {
              const doc = await createSprintDocument(sprintId, 'sprint_plan');
              if (doc) navigate(`/docs/${doc.id}`);
            }}
            onCreateRetro={async (sprintId) => {
              const doc = await createSprintDocument(sprintId, 'sprint_retro');
              if (doc) navigate(`/docs/${doc.id}`);
            }}
            onViewPlan={(sprintId) => navigate(`/sprints/${sprintId}/plan`)}
            onViewRetro={(sprintId) => navigate(`/sprints/${sprintId}/retro`)}
          />
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

  if (issues.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">No issues in this program</p>
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-background">
        <tr className="border-b border-border text-left text-xs text-muted">
          <th className="px-6 py-2 font-medium">ID</th>
          <th className="px-6 py-2 font-medium">Title</th>
          <th className="px-6 py-2 font-medium">Status</th>
          <th className="px-6 py-2 font-medium">Assignee</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr
            key={issue.id}
            onClick={() => onIssueClick(issue.id)}
            className="cursor-pointer border-b border-border/50 hover:bg-border/30 transition-colors"
          >
            <td className="px-6 py-3 text-sm font-mono text-muted">
              {issue.display_id}
            </td>
            <td className="px-6 py-3 text-sm text-foreground">
              {issue.title}
            </td>
            <td className="px-6 py-3">
              <span className={cn('rounded px-2 py-0.5 text-xs font-medium', issueStatusColors[issue.state])}>
                {stateLabels[issue.state] || issue.state}
              </span>
            </td>
            <td className={cn("px-6 py-3 text-sm text-muted", issue.assignee_archived && "opacity-50")}>
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
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>(program.github_repos || []);
  const [newRepoInput, setNewRepoInput] = useState('');

  const handleSave = () => {
    onUpdate({ name, description: description || null });
  };

  const handleEmojiChange = (emoji: string | null) => {
    onUpdate({ emoji });
  };

  const parseRepoInput = (input: string): GitHubRepo | null => {
    // Accept formats: "owner/repo" or "https://github.com/owner/repo"
    const trimmed = input.trim();

    // Try URL format first
    const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/\s]+)/);
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };
    }

    // Try owner/repo format
    const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (slashMatch) {
      return { owner: slashMatch[1], repo: slashMatch[2] };
    }

    return null;
  };

  const handleAddRepo = () => {
    const parsed = parseRepoInput(newRepoInput);
    if (!parsed) return;

    // Check for duplicates
    const exists = githubRepos.some(r => r.owner === parsed.owner && r.repo === parsed.repo);
    if (exists) {
      setNewRepoInput('');
      return;
    }

    const updated = [...githubRepos, parsed];
    setGithubRepos(updated);
    setNewRepoInput('');

    // Save immediately
    onUpdate({ github_repos: updated } as any);
  };

  const handleRemoveRepo = (index: number) => {
    const updated = githubRepos.filter((_, i) => i !== index);
    setGithubRepos(updated);
    onUpdate({ github_repos: updated } as any);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddRepo();
    }
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

      {/* GitHub Repos Section */}
      <div className="border-t border-border pt-6">
        <label className="mb-2 block text-sm font-medium text-foreground">GitHub Repositories</label>
        <p className="mb-3 text-xs text-muted">Link repositories to track PRs and commits for this program.</p>

        {/* Linked repos list */}
        {githubRepos.length > 0 && (
          <div className="mb-3 space-y-2">
            {githubRepos.map((repo, index) => (
              <div
                key={`${repo.owner}/${repo.repo}`}
                className="flex items-center justify-between rounded-md border border-border bg-background/50 px-3 py-2"
              >
                <a
                  href={`https://github.com/${repo.owner}/${repo.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground hover:text-accent"
                >
                  <GitHubIcon />
                  <span>{repo.owner}/{repo.repo}</span>
                </a>
                <button
                  onClick={() => handleRemoveRepo(index)}
                  className="p-1 text-muted hover:text-red-500 transition-colors"
                  aria-label={`Remove ${repo.owner}/${repo.repo}`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add repo input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newRepoInput}
            onChange={(e) => setNewRepoInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="owner/repo or GitHub URL"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={handleAddRepo}
            disabled={!parseRepoInput(newRepoInput)}
            className="rounded-md bg-border px-3 py-2 text-sm text-foreground hover:bg-border/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
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
