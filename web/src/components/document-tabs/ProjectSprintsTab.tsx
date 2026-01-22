import { useNavigate } from 'react-router-dom';
import { SprintList } from '@/components/SprintList';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProjectSprintsTab - Shows sprints associated with a project
 *
 * This is the "Sprints" tab content when viewing a project document.
 * Uses the unified SprintList component.
 */
export default function ProjectSprintsTab({ documentId }: DocumentTabProps) {
  const navigate = useNavigate();

  return (
    <SprintList
      lockedProjectId={documentId}
      onSprintClick={(sprintId) => navigate(`/documents/${sprintId}`)}
      emptyMessage="No sprints in this project"
      emptyHint="Link sprints to this project from the sprint editor"
    />
  );
}
