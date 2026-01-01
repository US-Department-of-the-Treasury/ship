-- Ship Database Schema
-- Everything is a Document - Unified Model
-- Multi-Workspace Architecture

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sprint_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Users and auth (global identity - users can belong to multiple workspaces)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,  -- NULL if using PIV-only auth
  name TEXT NOT NULL,
  is_super_admin BOOLEAN DEFAULT FALSE,
  last_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Workspace memberships (users can be in multiple workspaces with different roles)
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_document_id UUID,  -- Link to Person doc in this workspace (added after documents table)
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Workspace invites (email invite flow)
CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit logs (compliance-grade logging)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,  -- NULL for global actions
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  impersonating_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- If super-admin is impersonating
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sessions with 15-minute inactivity timeout and 12-hour absolute timeout
-- Session ID is TEXT (hex string from crypto.randomBytes) not UUID for enhanced security
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Session binding data for audit and security
  user_agent TEXT,
  ip_address TEXT
);

-- Document types enum
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('wiki', 'issue', 'program', 'project', 'sprint', 'person', 'sprint_plan', 'sprint_retro');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Core document table (unified model - EVERYTHING IS A DOCUMENT)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_type document_type NOT NULL DEFAULT 'wiki',
  title TEXT NOT NULL DEFAULT 'Untitled',

  -- TipTap JSON content stored as JSONB (shared by ALL document types)
  content JSONB DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',

  -- Yjs binary state for collaboration (shared by ALL document types)
  yjs_state BYTEA,

  -- Hierarchy (cascade delete: deleting parent deletes all children)
  parent_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,

  -- Associations (documents can reference other documents)
  program_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  project_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  sprint_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  -- Type-specific properties stored as JSONB
  -- Issue properties: state, priority, assignee_id, source, rejection_reason, feedback_status
  -- Program/Project properties: prefix, color
  -- Sprint properties: start_date, end_date, sprint_status, goal
  -- Person properties: email, role, capacity_hours
  properties JSONB DEFAULT '{}',

  -- Keep these as columns for indexing/relationships/sequences
  ticket_number INTEGER,  -- Auto-increment per workspace, needed for display_id
  archived_at TIMESTAMPTZ,  -- For filtering archived items

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Unique constraint for program prefixes within a workspace (using properties JSONB)
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_workspace_prefix
  ON documents(workspace_id, (properties->>'prefix'))
  WHERE document_type = 'program' AND properties->>'prefix' IS NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_workspace_id ON users(last_workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_document_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_program_id ON documents(program_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_sprint_id ON documents(sprint_id);
-- GIN index for efficient JSONB property queries
CREATE INDEX IF NOT EXISTS idx_documents_properties ON documents USING GIN (properties);

-- Workspace membership indexes
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_id ON workspace_memberships(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id ON workspace_memberships(user_id);

-- Workspace invite indexes
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_expires_at ON workspace_invites(expires_at);

-- Audit log indexes (compliance queries)
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Drop the legacy separate tables if they exist (greenfield cleanup)
DROP TABLE IF EXISTS sprints CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- File uploads (images, attachments)
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,        -- S3 object key (or local path for dev)
  cdn_url TEXT,                -- CloudFront URL after processing
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

-- Document links (for backlinks feature)
CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_document_links_target ON document_links(target_id);
CREATE INDEX IF NOT EXISTS idx_document_links_source ON document_links(source_id);
