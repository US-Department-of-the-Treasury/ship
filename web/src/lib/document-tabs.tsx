import React from 'react';

/**
 * Document Tab Configuration System
 *
 * This registry defines which tabs appear for each document type when viewed
 * in the UnifiedDocumentPage. Each document type can have its own set of tabs
 * with custom labels and components.
 */

/**
 * DocumentResponse represents the shape of a document from the API.
 * This is a flexible type since documents can have various properties
 * depending on their type.
 */
export interface DocumentResponse extends Record<string, unknown> {
  id: string;
  title: string;
  document_type: string;
  properties?: Record<string, unknown>;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  // Common optional fields
  program_id?: string | null;
  owner_id?: string | null;
  color?: string;
  emoji?: string | null;
}

export interface DocumentTabProps {
  documentId: string;
  document: DocumentResponse;
  /** Nested path segments after the tab, e.g., for /documents/:id/sprints/:sprintId, nestedPath would be the sprintId */
  nestedPath?: string;
}

export interface DocumentTabConfig {
  id: string;
  label: string | ((doc: DocumentResponse, counts?: TabCounts) => string);
  component: React.ComponentType<DocumentTabProps>;
}

export interface TabCounts {
  issues?: number;
  sprints?: number;
  projects?: number;
}

// Lazy load tab components to avoid circular dependencies
const ProjectDetailsTab = React.lazy(() => import('@/components/document-tabs/ProjectDetailsTab'));
const ProjectIssuesTab = React.lazy(() => import('@/components/document-tabs/ProjectIssuesTab'));
const ProjectSprintsTab = React.lazy(() => import('@/components/document-tabs/ProjectSprintsTab'));
const ProjectRetroTab = React.lazy(() => import('@/components/document-tabs/ProjectRetroTab'));

const ProgramOverviewTab = React.lazy(() => import('@/components/document-tabs/ProgramOverviewTab'));
const ProgramIssuesTab = React.lazy(() => import('@/components/document-tabs/ProgramIssuesTab'));
const ProgramProjectsTab = React.lazy(() => import('@/components/document-tabs/ProgramProjectsTab'));
const ProgramSprintsTab = React.lazy(() => import('@/components/document-tabs/ProgramSprintsTab'));

const SprintOverviewTab = React.lazy(() => import('@/components/document-tabs/SprintOverviewTab'));
const SprintPlanningTab = React.lazy(() => import('@/components/document-tabs/SprintPlanningTab'));
const SprintReviewTab = React.lazy(() => import('@/components/document-tabs/SprintReviewTab'));
const SprintStandupsTab = React.lazy(() => import('@/components/document-tabs/SprintStandupsTab'));

/**
 * Tab configurations for each document type.
 *
 * Document types without tabs (wiki, issue, sprint) will render directly
 * in the editor without a tab bar.
 */
export const documentTabConfigs: Record<string, DocumentTabConfig[]> = {
  project: [
    {
      id: 'details',
      label: 'Details',
      component: ProjectDetailsTab,
    },
    {
      id: 'issues',
      label: (_, counts) => counts?.issues ? `Issues (${counts.issues})` : 'Issues',
      component: ProjectIssuesTab,
    },
    {
      id: 'sprints',
      label: (_, counts) => counts?.sprints ? `Sprints (${counts.sprints})` : 'Sprints',
      component: ProjectSprintsTab,
    },
    {
      id: 'retro',
      label: 'Retro',
      component: ProjectRetroTab,
    },
  ],

  program: [
    {
      id: 'overview',
      label: 'Overview',
      component: ProgramOverviewTab,
    },
    {
      id: 'issues',
      label: (_, counts) => counts?.issues ? `Issues (${counts.issues})` : 'Issues',
      component: ProgramIssuesTab,
    },
    {
      id: 'projects',
      label: (_, counts) => counts?.projects ? `Projects (${counts.projects})` : 'Projects',
      component: ProgramProjectsTab,
    },
    {
      id: 'sprints',
      label: (_, counts) => counts?.sprints ? `Sprints (${counts.sprints})` : 'Sprints',
      component: ProgramSprintsTab,
    },
  ],

  sprint: [
    {
      id: 'overview',
      label: 'Overview',
      component: SprintOverviewTab,
    },
    {
      id: 'plan',
      label: 'Plan',
      component: SprintPlanningTab,
    },
    {
      id: 'review',
      label: 'Review',
      component: SprintReviewTab,
    },
    {
      id: 'standups',
      label: 'Standups',
      component: SprintStandupsTab,
    },
  ],

  // Document types without tabs - render directly in editor
  issue: [],
  wiki: [],
};

/**
 * Get tab configuration for a document type.
 * Returns empty array if document type has no tabs.
 */
export function getTabsForDocumentType(documentType: string): DocumentTabConfig[] {
  return documentTabConfigs[documentType] || [];
}

/**
 * Check if a document type has tabs.
 */
export function documentTypeHasTabs(documentType: string): boolean {
  const tabs = documentTabConfigs[documentType];
  return tabs !== undefined && tabs.length > 0;
}

/**
 * Get resolved tab labels with counts applied.
 */
export function resolveTabLabels(
  tabs: DocumentTabConfig[],
  document: DocumentResponse,
  counts?: TabCounts
): Array<{ id: string; label: string }> {
  return tabs.map(tab => ({
    id: tab.id,
    label: typeof tab.label === 'function' ? tab.label(document, counts) : tab.label,
  }));
}
