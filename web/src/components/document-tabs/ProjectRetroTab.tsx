import { ProjectRetro } from '@/components/ProjectRetro';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProjectRetroTab - Shows retrospective for a project
 *
 * This is the "Retro" tab content when viewing a project document.
 */
export default function ProjectRetroTab({ documentId }: DocumentTabProps) {
  return <ProjectRetro projectId={documentId} />;
}
