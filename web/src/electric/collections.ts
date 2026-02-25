import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  workspaceSchema,
  documentSchema,
  type WorkspaceRow,
  type DocumentRow,
} from './schemas.js'

const API_URL = import.meta.env.VITE_API_URL ?? window.location.origin

function shapeUrl(shapeName: string): string {
  return `${API_URL}/api/electric/${shapeName}`
}

// Electric's ShapeStream uses plain fetch() by default, which doesn't send cookies.
// Our proxy requires session auth, so we need to include credentials.
const fetchWithCredentials: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'include' })

// --- Workspaces ---
// Syncs: all workspaces (small table, no filtering needed)
// Ideal: filter by workspace_id from session (not needed for single-workspace prototype)
export const workspacesCollection = createCollection(
  electricCollectionOptions({
    id: 'workspaces',
    schema: workspaceSchema,
    getKey: (row: WorkspaceRow) => row.id,
    shapeOptions: { url: shapeUrl('workspaces'), fetchClient: fetchWithCredentials },
  })
)

// --- Person documents ---
// Current: filter by document_type='person' (server-side Electric shape)
// Ideal: also filter by workspace_id in shape where clause
// JSONB filtering (properties.user_id) done client-side in live queries
export const personsCollection = createCollection(
  electricCollectionOptions({
    id: 'persons',
    schema: documentSchema,
    getKey: (row: DocumentRow) => row.id,
    shapeOptions: { url: shapeUrl('documents-persons'), fetchClient: fetchWithCredentials },
  })
)

// --- Weekly plans ---
// Current: filter by document_type='weekly_plan' (server-side)
// Ideal: also filter by properties->>'person_id' and properties->>'week_number'
// Gap: Electric doesn't support JSONB operators in where clauses
// Fix: add person_id and week_number columns to documents table
export const weeklyPlansCollection = createCollection(
  electricCollectionOptions({
    id: 'weekly-plans',
    schema: documentSchema,
    getKey: (row: DocumentRow) => row.id,
    shapeOptions: { url: shapeUrl('documents-weekly-plans'), fetchClient: fetchWithCredentials },
  })
)

// --- Weekly retros ---
// Current: filter by document_type='weekly_retro' (server-side)
// Ideal: same as weekly plans — person_id + week_number filtering
// Gap: same JSONB limitation
// Fix: same column denormalization
export const weeklyRetrosCollection = createCollection(
  electricCollectionOptions({
    id: 'weekly-retros',
    schema: documentSchema,
    getKey: (row: DocumentRow) => row.id,
    shapeOptions: { url: shapeUrl('documents-weekly-retros'), fetchClient: fetchWithCredentials },
  })
)

// --- Standups ---
// Current: filter by document_type='standup' (server-side)
// Ideal: filter by properties->>'author_id' and properties->>'date'
// Gap: JSONB operators not supported in Electric where clauses
// Fix: add author_id UUID column and date DATE column to documents table
export const standupsCollection = createCollection(
  electricCollectionOptions({
    id: 'standups',
    schema: documentSchema,
    getKey: (row: DocumentRow) => row.id,
    shapeOptions: { url: shapeUrl('documents-standups'), fetchClient: fetchWithCredentials },
  })
)

// --- Sprints (weeks) ---
// Current: filter by document_type='sprint' (server-side)
// Ideal: filter by properties->'assignee_ids' ? $person_id (JSONB containment)
// Gap: JSONB containment operator not supported in Electric where clauses
// Fix: add assignee junction table or denormalize assignee_ids into rows
export const sprintsCollection = createCollection(
  electricCollectionOptions({
    id: 'sprints',
    schema: documentSchema,
    getKey: (row: DocumentRow) => row.id,
    shapeOptions: { url: shapeUrl('documents-sprints'), fetchClient: fetchWithCredentials },
  })
)

// --- Projects ---
// Current: filter by document_type='project' (server-side)
// Ideal: no additional JSONB filtering needed for MyWeekPage
//        (projects are joined from sprint.project_id references)
export const projectsCollection = createCollection(
  electricCollectionOptions({
    id: 'projects',
    schema: documentSchema,
    getKey: (row: DocumentRow) => row.id,
    shapeOptions: { url: shapeUrl('documents-projects'), fetchClient: fetchWithCredentials },
  })
)
