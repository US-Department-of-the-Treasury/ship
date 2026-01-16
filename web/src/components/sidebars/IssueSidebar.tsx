import { useState, useEffect } from 'react';
import { Combobox } from '@/components/ui/Combobox';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Issue {
  id: string;
  state: string;
  priority: string;
  estimate: number | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean;
  program_id: string | null;
  sprint_id: string | null;
  source?: 'internal' | 'external';
  rejection_reason?: string | null;
  converted_from_id?: string | null;
}

interface TeamMember {
  id: string;
  user_id: string;
  name: string;
}

interface Program {
  id: string;
  name: string;
  color?: string;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
  sprint_number: number;
}

interface IssueSidebarProps {
  issue: Issue;
  teamMembers: TeamMember[];
  programs: Program[];
  onUpdate: (updates: Partial<Issue>) => Promise<void>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  onAccept?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  isConverting?: boolean;
  isUndoing?: boolean;
}

const STATES = [
  { value: 'triage', label: 'Needs Triage' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No Priority' },
];

// Compute sprint dates from sprint number (1-week sprints)
function computeSprintDates(sprintNumber: number, workspaceStartDate: Date): { start: Date; end: Date } {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Format date range for display (e.g., "Jan 6 - Jan 19")
function formatDateRange(start: Date, end: Date): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startMonth = monthNames[start.getMonth()];
  const endMonth = monthNames[end.getMonth()];

  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} - ${end.getDate()}`;
  }
  return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
}

export function IssueSidebar({
  issue,
  teamMembers,
  programs,
  onUpdate,
  onConvert,
  onUndoConversion,
  onAccept,
  onReject,
  isConverting = false,
  isUndoing = false,
}: IssueSidebarProps) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [workspaceSprintStartDate, setWorkspaceSprintStartDate] = useState<Date | null>(null);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Fetch sprints when issue's program changes
  useEffect(() => {
    if (!issue.program_id) {
      setSprints([]);
      setWorkspaceSprintStartDate(null);
      return;
    }

    let cancelled = false;

    fetch(`${API_URL}/api/programs/${issue.program_id}/sprints`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : { sprints: [], workspace_sprint_start_date: null })
      .then(data => {
        if (!cancelled) {
          setSprints(data.sprints || []);
          if (data.workspace_sprint_start_date) {
            setWorkspaceSprintStartDate(new Date(data.workspace_sprint_start_date));
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSprints([]);
          setWorkspaceSprintStartDate(null);
        }
      });

    return () => { cancelled = true; };
  }, [issue.program_id]);

  const handleProgramChange = async (programId: string | null) => {
    await onUpdate({ program_id: programId, sprint_id: null } as Partial<Issue>);
  };

  const handleReject = () => {
    if (rejectReason.trim() && onReject) {
      onReject(rejectReason.trim());
      setRejectReason('');
      setShowRejectDialog(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Undo Conversion Banner */}
      {issue.converted_from_id && onUndoConversion && (
        <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
          <p className="mb-2 text-sm text-blue-300">This issue was converted from a project.</p>
          <button
            onClick={onUndoConversion}
            disabled={isUndoing}
            className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isUndoing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Undoing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Undo Conversion
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-blue-300/70 text-center">Restore the original project</p>
        </div>
      )}

      {/* Triage Actions */}
      {issue.state === 'triage' && onAccept && onReject && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="mb-3 text-sm font-medium text-amber-300">Needs Triage</p>
          {!showRejectDialog ? (
            <div className="flex gap-2">
              <button
                onClick={onAccept}
                className="flex-1 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() => setShowRejectDialog(true)}
                className="flex-1 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Reject
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection..."
                className="w-full rounded border border-border bg-border/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowRejectDialog(false); setRejectReason(''); }}
                  className="flex-1 rounded bg-border px-2 py-1 text-sm text-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim()}
                  className="flex-1 rounded bg-red-600 px-2 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <PropertyRow label="Status">
        <select
          value={issue.state}
          onChange={(e) => onUpdate({ state: e.target.value })}
          aria-label="Status"
          className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </PropertyRow>

      <PropertyRow label="Priority">
        <select
          value={issue.priority}
          onChange={(e) => onUpdate({ priority: e.target.value })}
          aria-label="Priority"
          className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </PropertyRow>

      <PropertyRow label="Estimate">
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            placeholder="—"
            aria-label="Estimate in hours"
            value={issue.estimate ?? ''}
            onChange={(e) => {
              const value = e.target.value ? parseFloat(e.target.value) : null;
              onUpdate({ estimate: value });
              if (value) setSprintError(null);
            }}
            className="w-20 rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="text-xs text-muted">hours</span>
        </div>
      </PropertyRow>

      <PropertyRow label="Assignee">
        <Combobox
          options={(() => {
            const options = teamMembers.map((m) => ({ value: m.user_id, label: m.name }));
            // If current assignee is archived and not in the active team members list, add them
            if (issue.assignee_id && issue.assignee_archived && issue.assignee_name) {
              const exists = options.some(o => o.value === issue.assignee_id);
              if (!exists) {
                options.unshift({ value: issue.assignee_id, label: `${issue.assignee_name} (archived)` });
              }
            }
            return options;
          })()}
          value={issue.assignee_id}
          onChange={(value) => onUpdate({ assignee_id: value })}
          placeholder="Unassigned"
          clearLabel="Unassigned"
          searchPlaceholder="Search people..."
          emptyText="No people found"
          aria-label="Assignee"
        />
      </PropertyRow>

      <PropertyRow label="Program">
        <Combobox
          options={programs.map((p) => ({ value: p.id, label: p.name, description: '' }))}
          value={issue.program_id}
          onChange={handleProgramChange}
          placeholder="No Program"
          clearLabel="No Program"
          searchPlaceholder="Search programs..."
          emptyText="No programs found"
          aria-label="Program"
        />
      </PropertyRow>

      {issue.program_id && (
        <PropertyRow label="Sprint">
          <Combobox
            options={sprints.map((s) => {
              let dateRange = '';
              if (workspaceSprintStartDate) {
                const { start, end } = computeSprintDates(s.sprint_number, workspaceSprintStartDate);
                dateRange = formatDateRange(start, end);
              }
              return { value: s.id, label: s.name, description: dateRange };
            })}
            value={issue.sprint_id}
            onChange={(value) => {
              if (value && !issue.estimate) {
                setSprintError('Please add an estimate before assigning to a sprint');
                return;
              }
              setSprintError(null);
              onUpdate({ sprint_id: value });
            }}
            placeholder="No Sprint"
            clearLabel="No Sprint"
            searchPlaceholder="Search sprints..."
            emptyText="No sprints found"
            aria-label="Sprint"
          />
          {sprintError && (
            <p className="mt-1 text-xs text-red-500">{sprintError}</p>
          )}
        </PropertyRow>
      )}

      <PropertyRow label="Source">
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
          issue.source === 'external' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
        }`}>
          {issue.source === 'external' ? 'External' : 'Internal'}
        </span>
      </PropertyRow>

      {issue.state === 'cancelled' && issue.rejection_reason && (
        <PropertyRow label="Rejection Reason">
          <span className="text-sm text-red-300">{issue.rejection_reason}</span>
        </PropertyRow>
      )}

      {/* Document Conversion */}
      {onConvert && (
        <div className="pt-4 mt-4 border-t border-border">
          <button
            onClick={onConvert}
            disabled={isConverting}
            className="w-full rounded bg-accent/20 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isConverting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Converting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                </svg>
                Promote to Project
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-muted text-center">Convert this issue into a project</p>
        </div>
      )}
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
