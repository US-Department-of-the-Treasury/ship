# Electric + TanStack DB Prototype Findings

**Date:** 2026-02-25
**Branch:** `feat/electric-tanstack-proto`
**Prototype surface:** MyWeekPage
**Electric version:** 1.4.7-1 (canary)
**TanStack DB version:** 0.x (beta)

## Summary

ElectricSQL can sync Postgres data to the browser in real-time via TanStack DB collections. The core sync mechanism works well: INSERTs and UPDATEs to Postgres appear on the page within ~2 seconds with no page reload. However, the JSONB-heavy unified document model creates a significant mismatch with Electric's filtering capabilities.

## What Works

- **Electric shapes** sync data from Postgres tables via HTTP streaming
- **Enum filtering** works: `document_type::text='person'` correctly filters in Electric where clauses
- **Column selection** works: excluding `content` and `yjs_state` reduces payload significantly
- **TanStack DB live queries** provide reactive, sub-millisecond client-side filtering
- **Real-time updates** via long-polling work correctly through an Express proxy
- **Optimistic mutations** are supported (not tested in this read-only prototype)

## What Doesn't Work

- **JSONB property filtering in shapes**: Electric's where clauses don't support JSONB operators (`->>`, `@>`, `?`). All JSONB filtering must happen client-side.
- **Cross-table joins**: Electric shapes are single-table. The MyWeekPage needed data from 2 tables (documents + workspaces) via 8 separate shapes.

## Shape-by-Shape Analysis

### workspaces

| Aspect | Detail |
|--------|--------|
| **Current filter** | None (full table) |
| **Ideal filter** | `id = $workspace_id` (from session) |
| **Gap** | None — table is small, full sync acceptable |
| **Fix needed** | None |

### documents (person)

| Aspect | Detail |
|--------|--------|
| **Current filter** | `document_type::text='person'` |
| **Ideal filter** | Also `properties->>'user_id' = $user_id` (single row needed) |
| **Gap** | Can't filter by JSONB `user_id` — syncs ALL person documents in workspace |
| **Fix** | Add `owner_user_id UUID` column to documents table |
| **Data volume impact** | Low — typically 10-50 person docs per workspace |

### documents (weekly_plan)

| Aspect | Detail |
|--------|--------|
| **Current filter** | `document_type::text='weekly_plan'` |
| **Ideal filter** | Also `properties->>'person_id' = $person_id AND properties->>'week_number' = $N` |
| **Gap** | Syncs ALL weekly plans for ALL people for ALL weeks |
| **Fix** | Add `person_id UUID` and `week_number INT` columns |
| **Data volume impact** | Medium — grows linearly: people x weeks (e.g., 10 people x 52 weeks = 520 docs) |

### documents (weekly_retro)

| Aspect | Detail |
|--------|--------|
| **Current filter** | `document_type::text='weekly_retro'` |
| **Ideal filter** | Same as weekly_plan — person_id + week_number |
| **Gap** | Same as weekly_plan |
| **Fix** | Same column denormalization |
| **Data volume impact** | Same as weekly_plan |

### documents (standup)

| Aspect | Detail |
|--------|--------|
| **Current filter** | `document_type::text='standup'` |
| **Ideal filter** | `properties->>'author_id' = $user_id AND properties->>'date' BETWEEN $start AND $end` |
| **Gap** | Syncs ALL standups for ALL people for ALL time |
| **Fix** | Add `author_user_id UUID` and `standup_date DATE` columns |
| **Data volume impact** | High — grows daily: people x days (e.g., 10 people x 365 days = 3,650 docs/year) |

### documents (sprint)

| Aspect | Detail |
|--------|--------|
| **Current filter** | `document_type::text='sprint'` |
| **Ideal filter** | `properties->'assignee_ids' ? $person_id AND properties->>'sprint_number' = $N` |
| **Gap** | JSONB containment operator (`?`) not supported. Syncs ALL sprints. |
| **Fix** | Create `sprint_assignees` junction table or add `assignee_id` column per row |
| **Data volume impact** | Medium — sprints x projects (e.g., 52 weeks x 5 projects = 260 docs) |

### documents (project)

| Aspect | Detail |
|--------|--------|
| **Current filter** | `document_type::text='project'` |
| **Ideal filter** | No additional JSONB filter needed — join from sprint references |
| **Gap** | None for MyWeekPage use case |
| **Fix** | None |
| **Data volume impact** | Low — typically 5-20 projects per workspace |

## Electric Infrastructure Findings

### Docker on Apple Silicon

Electric `latest` (1.4.7) has a [known arm64 packaging bug](https://github.com/electric-sql/electric/issues/3902) where `ex_sqlean` SQLite extensions are only compiled for amd64. The fix is in the `canary` image. Rosetta emulation doesn't work due to Erlang NIF incompatibility.

### Proxy Requirements

The Express proxy must:
1. Forward all `ELECTRIC_PROTOCOL_QUERY_PARAMS` (use the constant from `@electric-sql/client`)
2. Strip Electric's `Access-Control-*` headers (let Express CORS middleware handle them)
3. Configure CORS `exposedHeaders` to include `electric-offset`, `electric-handle`, `electric-schema`
4. Include `credentials: 'include'` in the `fetchClient` for cookie-based session auth
5. Control shape configuration (table, where, columns) server-side — never let clients define shapes

### Postgres Requirements

- `wal_level = logical` (set via `docker compose` command override)
- User needs `REPLICATION` role (Postgres Docker superuser has this by default)
- Electric creates a publication (`electric_publication_default`) and replication slot automatically
- Tables are added to the publication on first shape request

## Performance Observations

- **Initial sync**: All 8 shapes sync in parallel within ~2 seconds of page load
- **Real-time updates**: Changes appear within ~2 seconds via long-polling
- **Client-side filtering**: Negligible overhead — `useMemo` + `Array.find()` on small collections
- **HTTP/1.1 connection limit**: 7 shapes = 7 concurrent connections. Browsers allow 6 per origin, so 1 shape may queue. Not an issue for prototyping but HTTP/2 proxy recommended for production.

## Recommendation

**Conditional yes** — Electric + TanStack DB is viable for Ship, with schema changes.

### Required for production use:

1. **Denormalize key JSONB properties into columns** for shape filtering:
   - `person_id UUID` on weekly_plan, weekly_retro documents
   - `week_number INT` on weekly_plan, weekly_retro documents
   - `author_user_id UUID` and `standup_date DATE` on standup documents
   - These are additive migrations — existing JSONB properties remain for backwards compatibility

2. **Use HTTP/2 proxy** (Caddy or nginx) between browser and Electric to avoid connection limits

3. **Upgrade to Electric latest** once the arm64 fix ships in a tagged release

### What this buys you:

- **Eliminates custom API endpoints** for data that's just "read and display" (like MyWeekPage)
- **Real-time by default** — no WebSocket plumbing for non-collaborative data
- **Simplified client code** — live queries replace React Query hooks + fetch wrappers
- **Optimistic mutations** available when ready (txid-based reconciliation)

### What it doesn't replace:

- **TipTap/Yjs collaboration** — Electric doesn't handle CRDT document editing
- **Complex server-side queries** with joins, aggregations, computed fields
- **Write-side business logic** — validation, authorization, side effects still need API routes
