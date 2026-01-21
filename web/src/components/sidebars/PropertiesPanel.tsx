/**
 * PropertiesPanel - Unified sidebar component that renders type-specific properties
 *
 * This component consolidates the 4 type-specific sidebars into a single entry point.
 * It adapts based on document_type while maintaining the same rendering patterns.
 */
import { useMemo } from 'react';
import { WikiSidebar } from '@/components/sidebars/WikiSidebar';
import { IssueSidebar } from '@/components/sidebars/IssueSidebar';
import { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
import { SprintSidebar } from '@/components/sidebars/SprintSidebar';
import type { Person } from '@/components/PersonCombobox';
import type { BelongsTo } from '@ship/shared';

// Document types that have properties panels
export type PanelDocumentType = 'wiki' | 'issue' | 'project' | 'sprint';

// Base document interface
interface BaseDocument {
  id: string;
  title: string;
  document_type: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

// Wiki document properties
interface WikiDocument extends BaseDocument {
  document_type: 'wiki';
  parent_id?: string | null;
  visibility?: 'private' | 'workspace';
}

// Issue document properties
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
  belongs_to?: BelongsTo[];
}

// Project document properties
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

// Sprint document properties
interface SprintDocument extends BaseDocument {
  document_type: 'sprint';
  start_date: string;
  end_date: string;
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  issue_count?: number;
  completed_count?: number;
  hypothesis?: string;
}

// Union type for all documents
export type PanelDocument = WikiDocument | IssueDocument | ProjectDocument | SprintDocument;

// Props for wiki panel
interface WikiPanelProps {
  teamMembers: Person[];
  currentUserId?: string;
}

// Props for issue panel
interface IssuePanelProps {
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

// Props for project panel
interface ProjectPanelProps {
  programs: Array<{ id: string; name: string; emoji?: string | null }>;
  people: Person[];
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
}

// Props for sprint panel
interface SprintPanelProps {
  // Sprint panel doesn't need extra data currently
}

// Combined props type that includes all panel-specific props
type PanelSpecificProps = WikiPanelProps | IssuePanelProps | ProjectPanelProps | SprintPanelProps;

interface PropertiesPanelProps {
  /** The document to render properties for */
  document: PanelDocument;
  /** Type-specific data required for rendering */
  panelProps: PanelSpecificProps;
  /** Handler for document updates */
  onUpdate: (updates: Partial<PanelDocument>) => Promise<void>;
  /** Fields to highlight as missing (e.g., after type conversion) */
  highlightedFields?: string[];
}

/**
 * PropertiesPanel - Unified component that renders the appropriate sidebar
 * based on document_type.
 *
 * Usage:
 * ```tsx
 * <PropertiesPanel
 *   document={myDocument}
 *   panelProps={typeSpecificProps}
 *   onUpdate={handleUpdate}
 * />
 * ```
 */
export function PropertiesPanel({
  document,
  panelProps,
  onUpdate,
  highlightedFields = [],
}: PropertiesPanelProps) {
  const panel = useMemo(() => {
    switch (document.document_type) {
      case 'wiki': {
        const wikiProps = panelProps as WikiPanelProps;
        return (
          <WikiSidebar
            document={document as WikiDocument}
            teamMembers={wikiProps.teamMembers || []}
            currentUserId={wikiProps.currentUserId}
            onUpdate={onUpdate as (updates: Partial<WikiDocument>) => Promise<void>}
          />
        );
      }

      case 'issue': {
        const issueProps = panelProps as IssuePanelProps;
        return (
          <IssueSidebar
            issue={document as IssueDocument}
            teamMembers={issueProps.teamMembers || []}
            programs={issueProps.programs || []}
            projects={issueProps.projects || []}
            onUpdate={onUpdate as (updates: Partial<IssueDocument>) => Promise<void>}
            onConvert={issueProps.onConvert}
            onUndoConversion={issueProps.onUndoConversion}
            onAccept={issueProps.onAccept}
            onReject={issueProps.onReject}
            isConverting={issueProps.isConverting}
            isUndoing={issueProps.isUndoing}
            highlightedFields={highlightedFields}
            onAssociationChange={issueProps.onAssociationChange}
          />
        );
      }

      case 'project': {
        const projectProps = panelProps as ProjectPanelProps;
        return (
          <ProjectSidebar
            project={document as ProjectDocument}
            programs={projectProps.programs || []}
            people={projectProps.people || []}
            onUpdate={onUpdate as (updates: Partial<ProjectDocument>) => Promise<void>}
            onConvert={projectProps.onConvert}
            onUndoConversion={projectProps.onUndoConversion}
            isConverting={projectProps.isConverting}
            isUndoing={projectProps.isUndoing}
            highlightedFields={highlightedFields}
          />
        );
      }

      case 'sprint': {
        return (
          <SprintSidebar
            sprint={document as SprintDocument}
            onUpdate={onUpdate as (updates: Partial<SprintDocument>) => Promise<void>}
            highlightedFields={highlightedFields}
          />
        );
      }

      default:
        // TypeScript narrows to never here since all cases are handled
        // Cast to BaseDocument to access document_type for the fallback display
        return (
          <div className="p-4">
            <p className="text-xs text-muted">
              Document type: {(document as BaseDocument).document_type}
            </p>
          </div>
        );
    }
  }, [document, panelProps, onUpdate, highlightedFields]);

  return panel;
}

// Re-export types for convenience
export type {
  WikiDocument,
  IssueDocument,
  ProjectDocument,
  SprintDocument,
  WikiPanelProps,
  IssuePanelProps,
  ProjectPanelProps,
  SprintPanelProps,
};
