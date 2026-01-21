import { useNavigate } from 'react-router-dom';
import { SprintList } from '@/components/SprintList';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProgramSprintsTab - Shows sprints associated with a program
 *
 * This is the "Sprints" tab content when viewing a program document.
 * Uses the unified SprintList component.
 */
export default function ProgramSprintsTab({ documentId }: DocumentTabProps) {
  const navigate = useNavigate();

  return (
    <SprintList
      lockedProgramId={documentId}
      onSprintClick={(sprintId) => navigate(`/sprints/${sprintId}/view`)}
      showPlanButton={true}
      onPlanSprint={() => navigate(`/sprints/new/plan?program=${documentId}`)}
      emptyMessage="No sprints in this program"
      emptyHint="Create sprints using the Plan Sprint button"
    />
  );
}
