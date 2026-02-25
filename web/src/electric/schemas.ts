import { z } from 'zod'

// --- Workspace schema ---
// Matches the workspaces table columns
export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  sprint_start_date: z.string(), // DATE comes as string from Electric
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type WorkspaceRow = z.infer<typeof workspaceSchema>

// --- Document schema ---
// Matches the columns selected in the Electric shape config
// (id, workspace_id, document_type, title, properties, ticket_number,
//  created_at, updated_at, archived_at, deleted_at)
//
// Note: `properties` arrives as a JSON string from Electric (JSONB column).
// It must be parsed client-side to access typed fields.
export const documentSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  document_type: z.string(),
  title: z.string(),
  properties: z.any().nullable(), // JSONB may arrive as object or string from Electric
  ticket_number: z.coerce.number().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
})

export type DocumentRow = z.infer<typeof documentSchema>

// --- Parsed properties helpers ---
// These extract typed properties from the stringified JSONB

export interface PersonProperties {
  user_id: string
  email?: string
  reports_to?: string
}

export interface WeeklyPlanProperties {
  person_id: string
  week_number: number
  submitted_at?: string
  project_id?: string
}

export interface WeeklyRetroProperties {
  person_id: string
  week_number: number
  submitted_at?: string
}

export interface StandupProperties {
  author_id: string
  date: string
}

export interface SprintProperties {
  sprint_number: number
  owner_id: string
  project_id?: string
  assignee_ids?: string[]
}

export function parseProperties<T>(row: DocumentRow): T | null {
  if (!row.properties) return null
  // Electric may deliver JSONB as a parsed object or a string depending on version
  if (typeof row.properties === 'object') return row.properties as T
  try {
    return JSON.parse(row.properties) as T
  } catch {
    return null
  }
}
