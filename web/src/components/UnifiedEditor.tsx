import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { WikiSidebar } from '@/components/sidebars/WikiSidebar';
import { IssueSidebar } from '@/components/sidebars/IssueSidebar';
import { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
import { SprintSidebar } from '@/components/sidebars/SprintSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { Person } from '@/components/PersonCombobox';

export type DocumentType = 'wiki' | 'issue' | 'project' | 'sprint' | 'program' | 'person';

// Base document interface - common properties across all document types
interface BaseDocument {
  id: string;
  title: string;
  document_type: DocumentType;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

// Wiki document
interface WikiDocument extends BaseDocument {
  document_type: 'wiki';
  parent_id?: string | null;
  visibility?: 'private' | 'workspace';
}

// Issue document
interface IssueDocument extends BaseDocument {
  document_type: 'issue';
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
  display_id?: string;
}

// Project document
interface ProjectDocument extends BaseDocument {
  document_type: 'project';
  impact: number;
  confidence: number;
  ease: number;
  ice_score?: number;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string } | null;
  owner_id?: string | null;
  sprint_count?: number;
  issue_count?: number;
  converted_from_id?: string | null;
}

// Sprint document
interface SprintDocument extends BaseDocument {
  document_type: 'sprint';
  start_date: string;
  end_date: string;
  status: 'planned' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  issue_count?: number;
  completed_count?: number;
  hypothesis?: string;
}

// Union type for all document types
export type UnifiedDocument = WikiDocument | IssueDocument | ProjectDocument | SprintDocument | BaseDocument;

// Sidebar data types
interface WikiSidebarData {
  teamMembers: Person[];
}

interface IssueSidebarData {
  teamMembers: Array<{ id: string; user_id: string; name: string }>;
  programs: Array<{ id: string; name: string; color?: string }>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  onAccept?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  isConverting?: boolean;
  isUndoing?: boolean;
}

interface ProjectSidebarData {
  programs: Array<{ id: string; name: string; emoji?: string | null }>;
  people: Person[];
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
}

interface SprintSidebarData {
  // Sprint sidebar doesn't need extra data currently
}

export type SidebarData = WikiSidebarData | IssueSidebarData | ProjectSidebarData | SprintSidebarData;

interface UnifiedEditorProps {
  /** The document to edit */
  document: UnifiedDocument;
  /** Type-specific sidebar data */
  sidebarData?: SidebarData;
  /** Handler for document updates */
  onUpdate: (updates: Partial<UnifiedDocument>) => Promise<void>;
  /** Handler for back navigation */
  onBack?: () => void;
  /** Label for back button */
  backLabel?: string;
  /** Handler for document deletion */
  onDelete?: () => void;
  /** Room prefix for collaboration */
  roomPrefix?: string;
  /** Placeholder text for empty editor */
  placeholder?: string;
  /** Handler for creating sub-documents */
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  /** Handler for navigating to documents */
  onNavigateToDocument?: (docId: string) => void;
  /** Handler for document conversion events */
  onDocumentConverted?: (newDocId: string, newDocType: 'issue' | 'project') => void;
  /** Badge to show in header */
  headerBadge?: React.ReactNode;
}

/**
 * UnifiedEditor - Adaptive editor component that renders type-specific properties
 *
 * This component provides a unified editing experience for all document types
 * by adapting the properties sidebar based on document_type while using the
 * same TipTap editor for content.
 *
 * Usage:
 * ```tsx
 * <UnifiedEditor
 *   document={myDocument}
 *   sidebarData={typeSpecificData}
 *   onUpdate={handleUpdate}
 *   onBack={() => navigate(-1)}
 * />
 * ```
 */
export function UnifiedEditor({
  document,
  sidebarData = {},
  onUpdate,
  onBack,
  backLabel,
  onDelete,
  roomPrefix,
  placeholder,
  onCreateSubDocument,
  onNavigateToDocument,
  onDocumentConverted,
  headerBadge,
}: UnifiedEditorProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Auto-save title changes
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await onUpdate({ title });
    },
  });

  // Navigate to document handler
  const handleNavigateToDocument = useCallback((docId: string) => {
    if (onNavigateToDocument) {
      onNavigateToDocument(docId);
    } else {
      navigate(`/docs/${docId}`);
    }
  }, [navigate, onNavigateToDocument]);

  // Determine room prefix based on document type if not provided
  const effectiveRoomPrefix = roomPrefix || document.document_type;

  // Determine placeholder based on document type if not provided
  const effectivePlaceholder = placeholder || getDefaultPlaceholder(document.document_type);

  // Render the appropriate sidebar based on document type
  const sidebar = useMemo(() => {
    switch (document.document_type) {
      case 'wiki':
        return (
          <WikiSidebar
            document={document as WikiDocument}
            teamMembers={(sidebarData as WikiSidebarData).teamMembers || []}
            currentUserId={user?.id}
            onUpdate={onUpdate as (updates: Partial<WikiDocument>) => Promise<void>}
          />
        );

      case 'issue': {
        const issueData = sidebarData as IssueSidebarData;
        return (
          <IssueSidebar
            issue={document as IssueDocument}
            teamMembers={issueData.teamMembers || []}
            programs={issueData.programs || []}
            onUpdate={onUpdate as (updates: Partial<IssueDocument>) => Promise<void>}
            onConvert={issueData.onConvert}
            onUndoConversion={issueData.onUndoConversion}
            onAccept={issueData.onAccept}
            onReject={issueData.onReject}
            isConverting={issueData.isConverting}
            isUndoing={issueData.isUndoing}
          />
        );
      }

      case 'project': {
        const projectData = sidebarData as ProjectSidebarData;
        return (
          <ProjectSidebar
            project={document as ProjectDocument}
            programs={projectData.programs || []}
            people={projectData.people || []}
            onUpdate={onUpdate as (updates: Partial<ProjectDocument>) => Promise<void>}
            onConvert={projectData.onConvert}
            onUndoConversion={projectData.onUndoConversion}
            isConverting={projectData.isConverting}
            isUndoing={projectData.isUndoing}
          />
        );
      }

      case 'sprint':
        return (
          <SprintSidebar
            sprint={document as SprintDocument}
            onUpdate={onUpdate as (updates: Partial<SprintDocument>) => Promise<void>}
          />
        );

      // Default fallback for types without specific sidebars
      default:
        return (
          <div className="p-4">
            <p className="text-xs text-muted">
              Document type: {document.document_type}
            </p>
          </div>
        );
    }
  }, [document, sidebarData, user?.id, onUpdate]);

  if (!user) {
    return null;
  }

  return (
    <Editor
      documentId={document.id}
      userName={user.name}
      initialTitle={document.title}
      onTitleChange={throttledTitleSave}
      onBack={onBack}
      backLabel={backLabel}
      onDelete={onDelete}
      roomPrefix={effectiveRoomPrefix}
      placeholder={effectivePlaceholder}
      onCreateSubDocument={onCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      onDocumentConverted={onDocumentConverted}
      headerBadge={headerBadge}
      sidebar={sidebar}
    />
  );
}

/**
 * Get default placeholder text based on document type
 */
function getDefaultPlaceholder(documentType: DocumentType): string {
  switch (documentType) {
    case 'wiki':
      return 'Start writing...';
    case 'issue':
      return 'Add a description...';
    case 'project':
      return 'Describe this project...';
    case 'sprint':
      return 'Add sprint goals, notes, or description...';
    case 'program':
      return 'Describe this program...';
    case 'person':
      return 'Add notes about this person...';
    default:
      return 'Start writing...';
  }
}

// Re-export sidebar components for direct use
export { WikiSidebar } from '@/components/sidebars/WikiSidebar';
export { IssueSidebar } from '@/components/sidebars/IssueSidebar';
export { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
export { SprintSidebar } from '@/components/sidebars/SprintSidebar';
