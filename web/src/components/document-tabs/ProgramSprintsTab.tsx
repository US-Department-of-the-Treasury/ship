import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SprintTimeline, getCurrentSprintNumber, computeSprintDates, type Sprint } from '@/components/sprint/SprintTimeline';
import { SprintDetailView } from '@/components/sprint/SprintDetailView';
import { useSprints } from '@/hooks/useSprintsQuery';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { cn } from '@/lib/cn';
import type { DocumentTabProps } from '@/lib/document-tabs';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * ProgramSprintsTab - Shows sprints associated with a program
 *
 * This is the "Sprints" tab content when viewing a program document.
 * Features a horizontal scrolling SprintTimeline at the top.
 * When nestedPath contains a sprint ID, shows SprintDetailView inline.
 */
export default function ProgramSprintsTab({ documentId, nestedPath }: DocumentTabProps) {
  const navigate = useNavigate();
  const { sprints, loading, workspaceSprintStartDate, createSprint } = useSprints(documentId);
  const [showOwnerPrompt, setShowOwnerPrompt] = useState<number | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  // If nestedPath is provided and looks like a UUID, show sprint detail
  const isUuid = nestedPath && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nestedPath);
  const selectedSprintId = isUuid ? nestedPath : null;

  // Fetch team members for owner selection (filter out pending users)
  useEffect(() => {
    fetch(`${API_URL}/api/team/people`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((data: Person[]) => setPeople(data.filter(p => p.user_id)))
      .catch(console.error);
  }, []);

  // Handle sprint selection from timeline
  const handleSelectSprint = useCallback((_sprintNumber: number, sprint: Sprint | null) => {
    if (sprint) {
      navigate(`/documents/${documentId}/sprints/${sprint.id}`);
    }
  }, [documentId, navigate]);

  // Handle sprint open (double-click or direct navigation)
  const handleOpenSprint = useCallback((sprintId: string) => {
    navigate(`/documents/${documentId}/sprints/${sprintId}`);
  }, [documentId, navigate]);

  // Handle sprint creation
  const handleCreateSprint = useCallback(async (sprintNumber: number, ownerId: string) => {
    try {
      const newSprint = await createSprint(sprintNumber, ownerId, `Sprint ${sprintNumber}`);
      if (newSprint) {
        setShowOwnerPrompt(null);
        // Navigate to the new sprint
        navigate(`/documents/${documentId}/sprints/${newSprint.id}`);
      }
    } catch (err) {
      console.error('Failed to create sprint:', err);
    }
  }, [createSprint, documentId, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading sprints...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top Section: Horizontal Timeline - fixed height */}
      <div className="flex-shrink-0 border-b border-border p-4">
        <h3 className="mb-3 text-sm font-medium text-muted uppercase tracking-wide">Timeline</h3>
        <SprintTimeline
          sprints={sprints}
          workspaceSprintStartDate={workspaceSprintStartDate}
          selectedSprintId={selectedSprintId ?? undefined}
          onSelectSprint={handleSelectSprint}
          onOpenSprint={handleOpenSprint}
          onCreateClick={(num) => setShowOwnerPrompt(num)}
          showCreateOption={true}
        />
      </div>

      {/* Bottom Section: Sprint Details or Empty State */}
      <div className="flex-1 min-h-0 overflow-auto">
        {selectedSprintId ? (
          <SprintDetailView
            sprintId={selectedSprintId}
            programId={documentId}
            onIssueClick={(issueId) => navigate(`/documents/${issueId}`)}
            onBack={() => navigate(`/documents/${documentId}/sprints`)}
          />
        ) : (
          <EmptySprintState
            sprints={sprints}
            workspaceSprintStartDate={workspaceSprintStartDate}
            onPlanSprint={() => navigate(`/sprints/new/plan?program=${documentId}`)}
          />
        )}
      </div>

      {/* Owner Selection Prompt */}
      {showOwnerPrompt !== null && (
        <OwnerSelectPrompt
          sprintNumber={showOwnerPrompt}
          dateRange={computeSprintDates(showOwnerPrompt, workspaceSprintStartDate)}
          people={people}
          existingSprints={sprints}
          onSelect={(ownerId) => handleCreateSprint(showOwnerPrompt, ownerId)}
          onCancel={() => setShowOwnerPrompt(null)}
        />
      )}
    </div>
  );
}

// Empty state when no sprint is selected
interface EmptySprintStateProps {
  sprints: Sprint[];
  workspaceSprintStartDate: Date;
  onPlanSprint: () => void;
}

function EmptySprintState({ sprints, workspaceSprintStartDate, onPlanSprint }: EmptySprintStateProps) {
  const currentSprintNumber = getCurrentSprintNumber(workspaceSprintStartDate);
  const activeSprint = sprints.find(s => s.sprint_number === currentSprintNumber);

  if (sprints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-lg font-medium mb-2">No sprints yet</p>
        <p className="text-sm text-center mb-4 max-w-md">
          Click on a sprint window in the timeline above to create your first sprint,
          or use the plan sprint button to create one with full details.
        </p>
        <button
          onClick={onPlanSprint}
          className="rounded-md bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30 transition-colors"
        >
          Plan Sprint
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-muted p-8">
      <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
      </svg>
      <p className="text-lg font-medium mb-2">Select a sprint</p>
      <p className="text-sm text-center max-w-md">
        Click on a sprint in the timeline above to view its details, issues, and progress.
        {activeSprint && (
          <span className="block mt-2 text-accent">
            Sprint {activeSprint.sprint_number} is currently active.
          </span>
        )}
      </p>
    </div>
  );
}

// Owner selection prompt for sprint creation
function OwnerSelectPrompt({
  sprintNumber,
  dateRange,
  people,
  existingSprints,
  onSelect,
  onCancel,
}: {
  sprintNumber: number;
  dateRange: { start: Date; end: Date };
  people: Person[];
  existingSprints: Sprint[];
  onSelect: (ownerId: string) => void;
  onCancel: () => void;
}) {
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);

  // Check owner availability (simple version - just show who has sprints)
  const ownerSprintCounts = new Map<string, number>();
  existingSprints.forEach(s => {
    if (s.owner) {
      ownerSprintCounts.set(s.owner.id, (ownerSprintCounts.get(s.owner.id) || 0) + 1);
    }
  });

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
        <h2 className="text-lg font-semibold text-foreground">
          Create Sprint {sprintNumber}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
        </p>

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-muted">Who should own this sprint?</label>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {people.map((person) => {
              const sprintCount = ownerSprintCounts.get(person.user_id) || 0;
              return (
                <button
                  key={person.user_id}
                  onClick={() => setSelectedOwner(person.user_id)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selectedOwner === person.user_id
                      ? 'bg-accent text-white'
                      : 'bg-border/30 text-foreground hover:bg-border/50'
                  )}
                >
                  <span>{person.name}</span>
                  {sprintCount > 0 ? (
                    <span className={cn(
                      'text-xs',
                      selectedOwner === person.user_id ? 'text-white/70' : 'text-yellow-400'
                    )}>
                      {sprintCount} sprint{sprintCount > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className={cn(
                      'text-xs',
                      selectedOwner === person.user_id ? 'text-white/70' : 'text-green-400'
                    )}>
                      Available
                    </span>
                  )}
                </button>
              );
            })}
            {people.length === 0 && (
              <p className="text-sm text-muted py-2">No team members found</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedOwner && onSelect(selectedOwner)}
            disabled={!selectedOwner}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              selectedOwner
                ? 'bg-accent text-white hover:bg-accent/90'
                : 'bg-border text-muted cursor-not-allowed'
            )}
          >
            Create Sprint
          </button>
        </div>
      </div>
    </div>
  );
}
