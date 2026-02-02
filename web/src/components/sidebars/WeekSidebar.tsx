import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PropertyRow } from '@/components/ui/PropertyRow';
import { Combobox } from '@/components/ui/Combobox';
import { ApprovalButton } from '@/components/ApprovalButton';
import type { ApprovalTracking } from '@ship/shared';

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning', color: 'bg-blue-500' },
  { value: 'active', label: 'Active', color: 'bg-green-500' },
  { value: 'completed', label: 'Completed', color: 'bg-gray-500' },
];

interface SprintOwner {
  id: string;
  name: string;
  email: string;
}

interface Sprint {
  id: string;
  title?: string;  // Used in unified document model
  name?: string;   // Used in legacy sprint API
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  issue_count?: number;
  completed_count?: number;
  plan?: string;
  owner?: SprintOwner | null;
  owner_id?: string | null;
  // Approval tracking
  plan_approval?: ApprovalTracking | null;
  review_approval?: ApprovalTracking | null;
  // For RACI - who can approve
  accountable_id?: string | null;
  // Whether a review exists
  has_review?: boolean;
}

interface Person {
  id: string;
  user_id: string;
  name: string;
}

interface ExistingSprint {
  owner?: SprintOwner | null;
}

interface WeekSidebarProps {
  sprint: Sprint;
  onUpdate: (updates: Partial<Sprint>) => Promise<void>;
  /** Fields to highlight as missing (e.g., after type conversion) */
  highlightedFields?: string[];
  /** Team members for owner selection */
  people?: Person[];
  /** Existing sprints for calculating availability */
  existingSprints?: ExistingSprint[];
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove?: boolean;
  /** Current user ID (for showing approver name) */
  currentUserId?: string;
  /** Map of user ID to name for displaying approver */
  userNames?: Record<string, string>;
  /** Callback when approval state changes */
  onApprovalUpdate?: () => void;
}

export function WeekSidebar({
  sprint,
  onUpdate,
  highlightedFields = [],
  people = [],
  existingSprints = [],
  canApprove = false,
  userNames = {},
  onApprovalUpdate,
}: WeekSidebarProps) {
  const navigate = useNavigate();
  // Helper to check if a field should be highlighted
  const isHighlighted = (field: string) => highlightedFields.includes(field);

  const progress = (sprint.issue_count || 0) > 0
    ? Math.round(((sprint.completed_count || 0) / (sprint.issue_count || 1)) * 100)
    : 0;

  // Calculate owner availability (sprint count per person)
  const ownerOptions = useMemo(() => {
    // Count sprints per owner
    const ownerSprintCounts = new Map<string, number>();
    existingSprints.forEach(s => {
      if (s.owner?.id) {
        ownerSprintCounts.set(s.owner.id, (ownerSprintCounts.get(s.owner.id) || 0) + 1);
      }
    });

    // Build options with availability description
    return people
      .filter(p => p.user_id) // Only include people with user accounts
      .map(person => {
        const sprintCount = ownerSprintCounts.get(person.user_id) || 0;
        const availability = sprintCount === 0
          ? 'Available'
          : `${sprintCount} sprint${sprintCount > 1 ? 's' : ''}`;

        return {
          value: person.user_id,
          label: person.name,
          description: availability,
        };
      });
  }, [people, existingSprints]);

  return (
    <div className="space-y-4 p-4">
      <PropertyRow label="Owner">
        <Combobox
          options={ownerOptions}
          value={sprint.owner_id || null}
          onChange={(value) => onUpdate({ owner_id: value })}
          placeholder="Unassigned"
          clearLabel="Unassigned"
          searchPlaceholder="Search people..."
          emptyText="No people found"
          aria-label="Owner"
        />
      </PropertyRow>

      <PropertyRow label="Status" highlighted={isHighlighted('status')}>
        <select
          value={sprint.status}
          onChange={(e) => onUpdate({ status: e.target.value as Sprint['status'] })}
          className={`w-full rounded border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none ${
            isHighlighted('status') ? 'border-amber-500 bg-amber-500/10' : 'border-border'
          }`}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </PropertyRow>

      {/* Plan Approval - only show when plan exists */}
      {!!sprint.plan?.trim() && (
        <PropertyRow label="Plan Approval">
          <ApprovalButton
          type="plan"
          approval={sprint.plan_approval}
          hasContent={!!sprint.plan?.trim()}
          canApprove={canApprove}
          approveEndpoint={`/api/weeks/${sprint.id}/approve-plan`}
          approverName={sprint.plan_approval?.approved_by ? userNames[sprint.plan_approval.approved_by] : undefined}
          currentContent={sprint.plan || ''}
          onApproved={onApprovalUpdate}
        />
        </PropertyRow>
      )}

      <PropertyRow label="Progress">
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {sprint.completed_count || 0} of {sprint.issue_count || 0} issues completed ({progress}%)
          </p>
        </div>
      </PropertyRow>

      {/* Review Approval - only show for completed sprints with a review */}
      {sprint.status === 'completed' && (
        <PropertyRow label="Review Approval">
          <ApprovalButton
            type="review"
            approval={sprint.review_approval}
            hasContent={sprint.has_review ?? false}
            canApprove={canApprove}
            approveEndpoint={`/api/weeks/${sprint.id}/approve-review`}
            approverName={sprint.review_approval?.approved_by ? userNames[sprint.review_approval.approved_by] : undefined}
            onApproved={onApprovalUpdate}
          />
        </PropertyRow>
      )}

      {sprint.program_name && sprint.program_id && (
        <PropertyRow label="Program">
          <button
            onClick={() => navigate(`/documents/${sprint.program_id}`)}
            className="w-full rounded bg-border/50 px-2 py-1.5 text-left text-sm text-foreground hover:bg-border transition-colors"
          >
            {sprint.program_name}
          </button>
        </PropertyRow>
      )}

      <div className="border-t border-border pt-4">
        <button
          onClick={() => navigate(`/documents/${sprint.id}`)}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          Plan Week
        </button>
      </div>
    </div>
  );
}
