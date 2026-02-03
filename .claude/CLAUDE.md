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

**PostgreSQL must be running locally before dev or tests.** The user has local PostgreSQL installed (not Docker).

```bash
# Development (runs api + web in parallel)
pnpm dev              # Auto-creates database, finds available ports, starts both servers

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
pnpm db:migrate       # Run database migrations

# Unit tests (requires PostgreSQL running)
pnpm test             # Runs api unit tests via vitest
```

**What `pnpm dev` does** (via `scripts/dev.sh`):
1. Creates `api/.env.local` with DATABASE_URL if missing
2. Creates database (e.g., `ship_auth_jan_6`) if it doesn't exist
3. Runs migrations and seeds on fresh databases
4. Finds available ports (API: 3000+, Web: 5173+) for multi-worktree dev
5. Starts both servers in parallel

## Worktree Preflight Checklist

**Run this at the start of EVERY session on a worktree.** See `/ship-worktree-preflight` skill for full checklist and common issue fixes.

## E2E Testing

**ALWAYS use `/e2e-test-runner` when running E2E tests.** Never run `pnpm test:e2e` directly - it causes output explosion (600+ tests crash Claude Code). The skill handles background execution, progress polling via `test-results/summary.json`, and `--last-failed` for iterative fixing.

**Empty test footgun:** Tests with only TODO comments pass silently. Use `test.fixme()` for unimplemented tests. Pre-commit hook (`scripts/check-empty-tests.sh`) catches these.

**Seed data requirements:** When writing E2E tests that require specific data:
1. ALWAYS update `e2e/fixtures/isolated-env.ts` to create required data
2. NEVER use conditional `test.skip()` for missing data - use assertions with clear messages instead:
   ```typescript
   // BAD: skips silently
   if (rowCount < 4) { test.skip(true, 'Not enough rows'); return; }
   // GOOD: fails with actionable message
   expect(rowCount, 'Seed data should provide at least 4 issues. Run: pnpm db:seed').toBeGreaterThanOrEqual(4);
   ```
3. If a test needs N rows, ensure fixtures create at least N+2 rows

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

## Adding API Endpoints

**All API routes must be registered with OpenAPI.** This ensures Swagger docs and MCP tools stay in sync automatically.

When adding a new endpoint:

1. **Define schemas** in `api/src/openapi/schemas/{resource}.ts`:
   ```typescript
   import { registry, z } from '../registry.js';

   const MyResponseSchema = registry.register('MyResponse', z.object({
     success: z.literal(true),
     data: z.object({ /* fields */ }),
   }));
   ```

2. **Register the path** with `registry.registerPath()`:
   ```typescript
   registry.registerPath({
     method: 'get',
     path: '/resource/{id}',
     operationId: 'get_resource',  // Becomes MCP tool: ship_get_resource
     summary: 'Get a resource',
     tags: ['Resources'],
     request: {
       params: z.object({ id: z.string().uuid() }),
     },
     responses: {
       200: {
         description: 'Success',
         content: { 'application/json': { schema: MyResponseSchema } },
       },
     },
   });
   ```

3. **Implement the route** as usual in `api/src/routes/{resource}.ts`

**Result:** Swagger UI at `/api/docs/` shows the endpoint, and MCP server auto-generates a `ship_{operationId}` tool.

See `api/src/openapi/schemas/issues.ts` for a complete example.

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

**Just run the scripts.** They handle everything (terraform lookups, building, Docker tests, upload, deploy).

```bash
# Production deployment (from master branch)
./scripts/deploy.sh prod           # Backend → Elastic Beanstalk
./scripts/deploy-frontend.sh prod  # Frontend → S3/CloudFront

# Dev/Shadow deployment
./scripts/deploy.sh dev            # or shadow
./scripts/deploy-frontend.sh dev   # or shadow (no shadow support yet)
```

**DO NOT:**
- Run `terraform init` or `terraform plan` manually - scripts handle this
- Check EB health before deploying - scripts will fail if there's an issue
- Overcomplicate with pre-flight checks - just run the scripts

**After deploy, verify with browser:**
1. Navigate to the deployed URL
2. Check browser console for JavaScript errors (curl can't catch these)
3. Verify page renders correctly

**Health check URLs:**
- Prod API: `http://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com/health`
- Prod Web: `https://ship.awsdev.treasury.gov`

### Shadow Environment (UAT)

**Branch `feat/unified-document-model-v2`**: After completing work on this branch, ALWAYS deploy to shadow for user acceptance testing before merging to master. Production (`prod`) is only deployed after PR merge to master.

## Philosophy Enforcement

Use `/ship-philosophy-reviewer` to audit changes against Ship's core philosophy. Auto-triggers on schema changes, new components, or route additions. In autonomous contexts (ralph-loop), violations are fixed automatically.

**Core principles enforced:**
- Everything is a document (no new content tables)
- Reuse `Editor` component (no type-specific editors)
- "Untitled" for all new docs (not "Untitled Issue")
- YAGNI, boring technology, 4-panel layout

## Security Compliance

**NEVER use `git commit --no-verify`.** This bypasses security checks and is not acceptable.

### Pre-commit Hooks

This repo uses `comply opensource` as a pre-commit hook to scan for:
- Embedded secrets (gitleaks)
- Sensitive information (AI analysis)
- Vulnerability scanning (trivy)

### When Compliance Checks Fail

If the pre-commit hook fails:

1. **Fix the issue** - Remove secrets, update ATTESTATION.md, etc.
2. **If the tool itself is broken** - Report the bug, but do NOT bypass with `--no-verify`
3. **Emergency bypass procedure** - There is none. Fix the issue or wait for tool fix.

### CI Enforcement

GitHub Actions runs the same compliance checks on every PR. Even if someone bypasses local hooks:
- `secrets-scan` job runs gitleaks on full commit history
- `attestation-check` verifies ATTESTATION.md exists and is recent

These are **required status checks** - PRs cannot merge without passing.
