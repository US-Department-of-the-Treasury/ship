import { useNavigate } from 'react-router-dom';
import { SprintList } from '@/components/SprintList';
import { SprintDetailView } from '@/components/sprint/SprintDetailView';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProjectSprintsTab - Shows sprints associated with a project
 *
 * This is the "Sprints" tab content when viewing a project document.
 * When nestedPath contains a sprint ID, shows SprintDetailView inline.
 * Otherwise shows the unified SprintList component.
 */
export default function ProjectSprintsTab({ documentId, nestedPath }: DocumentTabProps) {
  const navigate = useNavigate();

  // If nestedPath is provided and looks like a UUID, show sprint detail
  const isUuid = nestedPath && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nestedPath);
  const selectedSprintId = isUuid ? nestedPath : null;

  if (selectedSprintId) {
    return (
      <SprintDetailView
        sprintId={selectedSprintId}
        projectId={documentId}
        onIssueClick={(issueId) => navigate(`/documents/${issueId}`)}
        onBack={() => navigate(`/documents/${documentId}/sprints`)}
      />
    );
  }

  return (
    <SprintList
      lockedProjectId={documentId}
      onSprintClick={(sprintId) => navigate(`/documents/${documentId}/sprints/${sprintId}`)}
      showPlanButton={true}
      onPlanSprint={() => navigate(`/sprints/new/plan?project=${documentId}`)}
      emptyMessage="No sprints in this project"
      emptyHint="Create sprints using the Plan Sprint button"
    />
  );
}
