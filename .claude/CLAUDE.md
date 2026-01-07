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

## E2E Testing

**ALWAYS use `/e2e-test-runner` when running E2E tests.** Never run `pnpm test:e2e` directly.

### Why This Matters

Running `pnpm test:e2e` directly causes two problems:
1. **Output explosion** - 600+ tests produce thousands of lines, crashing Claude Code
2. **No progress visibility** - You can't report status to the user during long runs

### The Correct Approach

The `/e2e-test-runner` skill:
1. Runs tests in background with output redirected
2. Polls `test-results/summary.json` for progress (report every 30s: "**Progress: 145/639 passed, 3 failed**")
3. Uses `--last-failed` for iterative fixing (avoids re-running passing tests)
4. Reads error details from `test-results/errors/*.log` only when investigating failures

### Key Files

| File | Purpose |
|------|---------|
| `test-results/summary.json` | Poll this for pass/fail counts (6 lines, safe to read) |
| `test-results/errors/*.log` | Detailed error logs per failure |
| `e2e/progress-reporter.ts` | Custom reporter that writes progress |
| `scripts/watch-tests.sh` | Terminal watcher for humans |

### Quick Reference

```bash
# WRONG - Don't do this
pnpm test:e2e                           # Output explosion, no progress

# RIGHT - Use the skill
/e2e-test-runner                        # Handles everything correctly

# Or manually with background + polling
pnpm test:e2e > /tmp/tests.log 2>&1 &   # Background
cat test-results/summary.json           # Poll progress
pnpm test:e2e --last-failed             # Verify fixes
```

### Anti-Patterns

- **Never** run full test suite after each fix - use `--last-failed`
- **Never** read raw test output - poll `summary.json` instead
- **Never** skip progress updates - user needs visibility during 5+ min runs

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

**"Deploy" means deploy BOTH API and frontend.** Never deploy just one - they must stay in sync.

### Full deploy sequence:
```bash
# 1. Deploy API
./scripts/deploy.sh

# 2. Monitor API until healthy (poll every 30s until Green/Ready)
aws elasticbeanstalk describe-environments --environment-names ship-api-prod --query 'Environments[0].[Health,HealthStatus,Status]'

# 3. Deploy frontend
pnpm build:web
aws s3 sync web/dist/ s3://$(cd terraform && terraform output -raw s3_bucket_name)/ --delete
aws cloudfront create-invalidation --distribution-id $(cd terraform && terraform output -raw cloudfront_distribution_id) --paths "/*"

# 4. Wait for CloudFront invalidation to complete
aws cloudfront get-invalidation --distribution-id DIST_ID --id INVALIDATION_ID --query 'Invalidation.Status'
```

**After deploying, monitor until complete.** Poll every 30 seconds until Status is `Ready` and Health is `Green`. During rolling updates, temporary `Red/Degraded` status is normal while old instances drain. Don't report "done" until both API and frontend are fully deployed.

**Deployment details:**
- API uses **RollingWithAdditionalBatch** for zero-downtime deploys (3-5 min)
- ALB health check hits `/health` endpoint
- Frontend deploys to S3, served via CloudFront
- CloudFront invalidation typically completes in 30-60 seconds

## E2E Testing

**Empty Playwright tests pass silently - major footgun.** A test with only a TODO comment passes as if it were real:

```typescript
// WRONG - passes silently, gives false confidence
test('my test', async ({ page }) => {
  // TODO: implement this test
});

// RIGHT - shows as "fixme" in report, not "passed"
test.fixme('my test', async ({ page }) => {
  // TODO: implement this test
});
```

A pre-commit hook (`scripts/check-empty-tests.sh`) catches empty tests. Tests must have `expect()` or `page.` calls to be considered non-empty.

## Philosophy Enforcement

Use `/ship-philosophy-reviewer` to audit changes against Ship's core philosophy. Auto-triggers on schema changes, new components, or route additions. In autonomous contexts (ralph-loop), violations are fixed automatically.

**Core principles enforced:**
- Everything is a document (no new content tables)
- Reuse `Editor` component (no type-specific editors)
- "Untitled" for all new docs (not "Untitled Issue")
- YAGNI, boring technology, 4-panel layout
