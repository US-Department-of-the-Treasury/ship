# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architectural Documentation

**Read `docs/*` before making architectural decisions.** These documents capture the design philosophy and key decisions:

- `docs/unified-document-model.md` - Core data model, sync architecture, document types
- `docs/application-architecture.md` - Tech stack decisions, deployment, testing strategy
- `docs/document-model-conventions.md` - Terminology, what becomes a document vs config
- `docs/sprint-documentation-philosophy.md` - Sprint workflow and required documentation

When in doubt about implementation approach, check these docs first.

## Commands

```bash
# Development (runs api + web in parallel)
pnpm dev

# Run individual packages
pnpm dev:api          # Express server on :3000
pnpm dev:web          # Vite dev server on :5173

# Build
pnpm build            # Build all packages
pnpm build:shared     # Build shared types first (required before api/web)

# Type checking
pnpm type-check       # Check all packages

# Database
pnpm db:seed          # Seed database with test data
```

## Architecture

**Monorepo Structure** (pnpm workspaces):
- `api/` - Express backend with WebSocket collaboration
- `web/` - React + Vite frontend with TipTap editor
- `shared/` - TypeScript types shared between packages

**Unified Document Model**: Everything is stored in a single `documents` table with a `document_type` field (wiki, issue, program, project, sprint, person). This follows Notion's paradigm where the difference between content types is properties, not structure.

**Real-time Collaboration**: TipTap editor uses Yjs CRDTs synced via WebSocket at `/collaboration/{docType}:{docId}`. The collaboration server (`api/src/collaboration/index.ts`) handles sync protocol and persists Yjs state to PostgreSQL.

## Key Patterns

**4-Panel Editor Layout**: Every document editor uses the same layout: Icon Rail (48px) → Contextual Sidebar (224px, shows mode's item list) → Main Content (flex-1, editor) → Properties Sidebar (256px, doc-type-specific props). All four panels are always visible. See `docs/document-model-conventions.md` for the diagram.

**New document titles**: All document types use `"Untitled"` as the default title. No variations like "Untitled Issue" or "Untitled Project". The shared Editor component expects this exact string to show placeholder styling. See `docs/document-model-conventions.md` for details.

**Document associations**: Documents reference other documents via `parent_id`, `project_id`, and `sprint_id`. Issues belong to projects and can be assigned to sprints.

**Editor content**: All document types use the same TipTap JSON content structure stored in `content` column, with Yjs binary state in `yjs_state` for conflict-free collaboration.

**API routes**: REST endpoints at `/api/{resource}` (documents, issues, projects, sprints). Auth uses session cookies with 15-minute timeout.

## Database

PostgreSQL with direct SQL queries via `pg` (no ORM). Schema defined in `api/src/db/schema.sql`.

**Migrations:** Schema changes MUST be in numbered migration files:

```
api/src/db/migrations/
├── 001_properties_jsonb.sql
├── 002_person_membership_decoupling.sql
└── ...
```

- Name files: `NNN_description.sql` (e.g., `003_add_tags.sql`)
- Migrations run automatically on deploy via `api/src/db/migrate.ts`
- The `schema_migrations` table tracks which migrations have been applied
- Each migration runs in a transaction with automatic rollback on failure

**Never modify schema.sql directly for existing tables.** Schema.sql is for initial setup only. All changes to existing tables go in migration files.

Local dev uses `.env.local` for DB connection.

## Deployment

**Always use the deploy script:** `./scripts/deploy.sh`

This script:
1. Builds if needed (checks for dist directories)
2. Creates a zip bundle with Dockerfile at root (required by EB)
3. Uploads to S3 and deploys to Elastic Beanstalk

**Works from any worktree** - the Dockerfile is at repo root, so every worktree has it.

```bash
# Deploy API to production
./scripts/deploy.sh

# Monitor deployment (takes 3-5 min for rolling update)
aws elasticbeanstalk describe-environments --environment-names ship-api-prod --query 'Environments[0].[Health,HealthStatus]'

# Check instance health if issues
aws elasticbeanstalk describe-instances-health --environment-name ship-api-prod --attribute-names All
```

**Deployment details:**
- Uses **RollingWithAdditionalBatch** for zero-downtime deploys
- ALB health check hits `/health` endpoint (returns `{"status":"ok"}`)
- Full EB environment is managed by Terraform (`terraform/elastic-beanstalk.tf`)
- Deploys take 3-5 minutes due to rolling instance replacement

**After deploying, monitor until complete.** Don't just report "deployment started" and leave the user with a command to run. Poll the environment status every 30 seconds until Status is `Ready` and Health is `Green`. During rolling updates, temporary `Red/Degraded` status is normal while old instances drain.

**Frontend deployment** (S3 + CloudFront):
```bash
pnpm build:web
aws s3 sync web/dist/ s3://$(cd terraform && terraform output -raw s3_bucket_name)/ --delete
aws cloudfront create-invalidation --distribution-id $(cd terraform && terraform output -raw cloudfront_distribution_id) --paths "/*"
```

## Philosophy Enforcement

Use `/ship-philosophy-reviewer` to audit changes against Ship's core philosophy. Auto-triggers on schema changes, new components, or route additions. In autonomous contexts (ralph-loop), violations are fixed automatically.

**Core principles enforced:**
- Everything is a document (no new content tables)
- Reuse `Editor` component (no type-specific editors)
- "Untitled" for all new docs (not "Untitled Issue")
- YAGNI, boring technology, 4-panel layout
