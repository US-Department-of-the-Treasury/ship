import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SprintTimeline, getCurrentSprintNumber, computeSprintDates, type Sprint } from '@/components/sprint/SprintTimeline';
import { SprintDetailView } from '@/components/sprint/SprintDetailView';
import { useSprints } from '@/hooks/useSprintsQuery';
import { apiPost } from '@/lib/api';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProgramSprintsTab - Shows sprints associated with a program
 *
 * This is the "Sprints" tab content when viewing a program document.
 * Features a horizontal scrolling SprintTimeline at the top.
 * When nestedPath contains a sprint ID, shows SprintDetailView inline.
 */
export default function ProgramSprintsTab({ documentId, nestedPath }: DocumentTabProps) {
  const navigate = useNavigate();
  const { sprints, loading, workspaceSprintStartDate, refreshSprints } = useSprints(documentId);

  // If nestedPath is provided and looks like a UUID, show sprint detail
  const isUuid = nestedPath && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nestedPath);
  const selectedSprintId = isUuid ? nestedPath : null;

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

  // Handle sprint creation - follows document creation pattern (no modal)
  const handleCreateSprint = useCallback(async (sprintNumber: number) => {
    try {
      // Calculate date range for sprint
      const dateRange = computeSprintDates(sprintNumber, workspaceSprintStartDate);

      // Create sprint via document API - no owner (user sets on sprint page)
      const res = await apiPost('/api/documents', {
        document_type: 'sprint',
        title: `Sprint ${sprintNumber}`,
        properties: {
          sprint_number: sprintNumber,
          status: 'planning',
          start_date: dateRange.start.toISOString(),
          end_date: dateRange.end.toISOString(),
        },
        belongs_to: [{ id: documentId, type: 'program' }],
      });

      if (res.ok) {
        const newSprint = await res.json();
        // Refresh sprint list and navigate to the new sprint
        await refreshSprints();
        navigate(`/documents/${newSprint.id}`);
      } else {
        console.error('Failed to create sprint:', await res.text());
      }
    } catch (err) {
      console.error('Failed to create sprint:', err);
    }
  }, [documentId, workspaceSprintStartDate, refreshSprints, navigate]);

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
          onCreateClick={handleCreateSprint}
          showCreateOption={true}
        />
      </div>

      {/* Bottom Section: Sprint Details or Empty State */}
      <div className="flex-1 min-h-0 overflow-auto">
        {selectedSprintId ? (
          <SprintDetailView
            sprintId={selectedSprintId}
            programId={documentId}
            onBack={() => navigate(`/documents/${documentId}/sprints`)}
          />
        ) : (
          <EmptySprintState
            sprints={sprints}
            workspaceSprintStartDate={workspaceSprintStartDate}
          />
        )}
      </div>
    </div>
  );
}

// Empty state when no sprint is selected
interface EmptySprintStateProps {
  sprints: Sprint[];
  workspaceSprintStartDate: Date;
}

function EmptySprintState({
  sprints,
  workspaceSprintStartDate,
}: EmptySprintStateProps) {
  const currentSprintNumber = getCurrentSprintNumber(workspaceSprintStartDate);
  const activeSprint = sprints.find(s => s.sprint_number === currentSprintNumber);

  if (sprints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-lg font-medium mb-2">No sprints yet</p>
        <p className="text-sm text-center max-w-md">
          Click on a sprint window in the timeline above to create your first sprint.
        </p>
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

