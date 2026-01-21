import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { WikiSidebar } from '@/components/sidebars/WikiSidebar';
import { IssueSidebar } from '@/components/sidebars/IssueSidebar';
import { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
import { SprintSidebar } from '@/components/sidebars/SprintSidebar';
import { DocumentTypeSelector, getMissingRequiredFields } from '@/components/sidebars/DocumentTypeSelector';
import type { DocumentType as SelectableDocumentType } from '@/components/sidebars/DocumentTypeSelector';
import { useAuth } from '@/hooks/useAuth';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { Person } from '@/components/PersonCombobox';
import type { BelongsTo } from '@ship/shared';

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
  belongs_to?: BelongsTo[];
}

// Project document
interface ProjectDocument extends BaseDocument {
  document_type: 'project';
  impact: number | null;
  confidence: number | null;
  ease: number | null;
  ice_score?: number | null;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string; email: string } | null;
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
  projects?: Array<{ id: string; title: string; color?: string }>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  onAccept?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  isConverting?: boolean;
  isUndoing?: boolean;
  onAssociationChange?: () => void;
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
  /** Whether to show the document type selector */
  showTypeSelector?: boolean;
  /** Handler for document type changes (if different from onUpdate) */
  onTypeChange?: (newType: DocumentType) => Promise<void>;
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
  showTypeSelector = false,
  onTypeChange,
}: UnifiedEditorProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isChangingType, setIsChangingType] = useState(false);

  // Track missing required fields after type changes
  const missingFields = useMemo(() => {
    const selectableType = document.document_type as SelectableDocumentType;
    if (['wiki', 'issue', 'project', 'sprint'].includes(selectableType)) {
      // Build properties object from document
      const props: Record<string, unknown> = {
        ...document.properties,
        // Include top-level fields that might be required
        state: (document as IssueDocument).state,
        priority: (document as IssueDocument).priority,
        impact: (document as ProjectDocument).impact,
        confidence: (document as ProjectDocument).confidence,
        ease: (document as ProjectDocument).ease,
        start_date: (document as SprintDocument).start_date,
        end_date: (document as SprintDocument).end_date,
        status: (document as SprintDocument).status,
      };
      return getMissingRequiredFields(selectableType, props);
    }
    return [];
  }, [document]);

  // Auto-save title changes
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await onUpdate({ title });
    },
  });

  // Handle document type change
  const handleTypeChange = useCallback(async (newType: SelectableDocumentType) => {
    if (newType === document.document_type) return;

    setIsChangingType(true);
    try {
      if (onTypeChange) {
        await onTypeChange(newType as DocumentType);
      } else {
        await onUpdate({ document_type: newType as DocumentType } as Partial<UnifiedDocument>);
      }
    } finally {
      setIsChangingType(false);
    }
  }, [document.document_type, onTypeChange, onUpdate]);

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

  // Check if this document type can have its type changed
  const canChangeType = ['wiki', 'issue', 'project', 'sprint'].includes(document.document_type);

  // Render the type-specific sidebar content
  const typeSpecificSidebar = useMemo(() => {
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
            projects={issueData.projects || []}
            onUpdate={onUpdate as (updates: Partial<IssueDocument>) => Promise<void>}
            onConvert={issueData.onConvert}
            onUndoConversion={issueData.onUndoConversion}
            onAccept={issueData.onAccept}
            onReject={issueData.onReject}
            isConverting={issueData.isConverting}
            isUndoing={issueData.isUndoing}
            highlightedFields={missingFields}
            onAssociationChange={issueData.onAssociationChange}
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
            highlightedFields={missingFields}
          />
        );
      }

      case 'sprint':
        return (
          <SprintSidebar
            sprint={document as SprintDocument}
            onUpdate={onUpdate as (updates: Partial<SprintDocument>) => Promise<void>}
            highlightedFields={missingFields}
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
  }, [document, sidebarData, user?.id, onUpdate, missingFields]);

  // Compose full sidebar with type selector
  const sidebar = useMemo(() => {
    // If we're not showing the type selector, just return the type-specific sidebar
    if (!showTypeSelector || !canChangeType) {
      return typeSpecificSidebar;
    }

    // Add type selector at the top
    return (
      <div className="flex flex-col h-full">
        {/* Type Selector */}
        <div className="p-4 border-b border-border">
          <DocumentTypeSelector
            value={document.document_type as SelectableDocumentType}
            onChange={handleTypeChange}
            disabled={isChangingType}
          />
          {missingFields.length > 0 && (
            <p className="mt-2 text-xs text-amber-500">
              Please fill in required fields: {missingFields.join(', ')}
            </p>
          )}
        </div>
        {/* Type-specific sidebar */}
        <div className="flex-1 overflow-auto pb-20">
          {typeSpecificSidebar}
        </div>
      </div>
    );
  }, [showTypeSelector, canChangeType, typeSpecificSidebar, document.document_type, handleTypeChange, isChangingType, missingFields]);

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
