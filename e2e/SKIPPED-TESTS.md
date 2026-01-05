# Skipped E2E Tests - Status and Blockers

This document tracks E2E test status and remaining blockers.

## Summary

| Category | Status | Notes |
|----------|--------|-------|
| Offline functionality | **ENABLED** | Infrastructure implemented, tests passing |
| WebSocket rate limiting | Skipped | Server-side rate limiting not implemented |
| Real-time backlinks | Skipped | Multi-browser WebSocket coordination flaky |
| Content caching | **ENABLED** | Same infrastructure as offline |
| Conditional skips | N/A | Runtime conditions (acceptable) |

---

## 1. Offline Functionality Tests (33 files) - ENABLED

**Files:** `offline-*.spec.ts`

**Status:** Infrastructure is fully implemented and tests are enabled.

**Implementation (already done):**
- `web/src/lib/queryClient.ts` - TanStack Query with IndexedDB persistence via `idb-keyval`
- `web/src/lib/syncHandlers.ts` - Mutation queue sync handlers
- `web/src/components/OfflineIndicator.tsx` - UI indicator
- `web/src/components/PendingSyncIcon.tsx` - Pending sync indicator
- Service worker registration in `main.tsx`

**Remaining individual test.skip() calls:**
- `offline-01-list-cache.spec.ts` - Lists load from IndexedDB when offline
- `offline-02-mutations.spec.ts` - Create/update/delete queues offline
- `offline-03-editor-content.spec.ts` - Editor content persists offline
- `offline-04-queue-management.spec.ts` - Queue persistence across reloads
- `offline-05-error-handling.spec.ts` - Sync conflicts and network flakiness
- `offline-06-ui-indicators.spec.ts` - Offline status display
- `offline-07-session-handling.spec.ts` - Session expiry while offline
- `offline-08-websocket.spec.ts` - WebSocket disconnect/reconnect
- `offline-09-cold-start.spec.ts` - First visit while offline
- `offline-10-search-filter.spec.ts` - Search on cached data
- `offline-11-multi-tab.spec.ts` - Multiple tabs offline
- `offline-12-extended-periods.spec.ts` - Long offline duration
- `offline-13-storage-limits.spec.ts` - Storage quota handling
- `offline-14-server-validation.spec.ts` - Invalid offline data
- `offline-15-chained-operations.spec.ts` - Create-edit-delete chains
- `offline-16-optimistic-rollback.spec.ts` - Rollback on sync failure
- `offline-17-user-controls.spec.ts` - Manual sync controls
- `offline-18-browser-close.spec.ts` - Incomplete sync recovery
- `offline-19-*.spec.ts` - Entity-specific offline operations (assignee, programs, sprints, projects)
- `offline-20-reference-integrity.spec.ts` - Referenced entity deleted while offline
- `offline-21-server-unreachable.spec.ts` - Network online but server down
- `offline-22-background-tab.spec.ts` - Tab visibility changes
- `offline-23-ticket-collision.spec.ts` - Concurrent offline issue creation
- `offline-24-rapid-mutations.spec.ts` - Mutation debouncing
- `offline-25-corruption-recovery.spec.ts` - Corrupted cache handling
- `offline-26-schema-migration.spec.ts` - Old cache format after app update
- `offline-27-accessibility.spec.ts` - Screen reader announcements
- `offline-28-flaky-network.spec.ts` - Request timeout during sync
- `offline-29-private-mode.spec.ts` - IndexedDB unavailable
- `offline-30-permission-changes.spec.ts` - Access revoked during offline
- `offline-31-large-content.spec.ts` - Large documents sync correctly
- `offline-32-ui-state.spec.ts` - Focus and scroll state
- `offline-33-version-mismatch.spec.ts` - Old cached app, new API

---

## 2. WebSocket Rate Limiting Tests (1 file)

**File:** `critical-blockers.spec.ts` (lines 145-157)

**Infrastructure Required:**
- Server-side WebSocket rate limiting middleware
- Connection attempt throttling per IP/session
- Message rate limiting per connection

**Tests Blocked:**
- `WebSocket rejects excessive connection attempts`
- `WebSocket limits messages per second`

**Implementation Path:**
1. Add rate limiting to collaboration server (`api/src/collaboration/index.ts`)
2. Configure limits: max connections per minute, max messages per second
3. Return appropriate error codes for rate-limited requests

---

## 3. Real-time Backlinks Tests (1 file)

**File:** `backlinks.spec.ts` (lines 216, 287)

**Infrastructure Required:**
- Multi-browser WebSocket coordination in tests
- Reliable cross-browser event synchronization

**Tests Blocked:**
- `clicking backlink navigates to source document` - Navigation after click
- `backlinks update in real-time` - Cross-browser WebSocket sync

**Implementation Path:**
1. Use Playwright's `browser.newContext()` for multi-user scenarios
2. Implement WebSocket message waiting with proper timeouts
3. Add retry logic for flaky real-time assertions

---

## 4. Content Caching Tests (1 file)

**File:** `content-caching.spec.ts`

**Infrastructure Required:**
- TanStack Query cache persistence (same as offline tests)
- Optimistic cache reads before network requests

**Tests Blocked:**
- `document content loads instantly from cache on revisit`
- `toggling between two documents shows no blank flash`
- `cached content is available even when WebSocket is slow`

**Implementation Path:**
Same as offline functionality - requires TanStack Query persistence layer.

---

## 5. Conditional Skips (Not Infrastructure Blockers)

**Files:** `features-real.spec.ts`, `accessibility-remediation.spec.ts`

These are runtime conditional skips, not infrastructure blockers:
- `features-real.spec.ts` - Skips when feature flags are disabled
- `accessibility-remediation.spec.ts` - Skips when test data doesn't have nested documents

These are acceptable and don't require infrastructure changes.

---

## 6. Program Issue Creation (1 file)

**File:** `programs.spec.ts` (line 140)

**Test:** `can create issue from program Issues tab`

**Blocker:** UI implementation incomplete - the "Create Issue" button in program view needs to be connected to issue creation flow.

**Implementation Path:**
1. Add "New Issue" button to ProgramView Issues tab
2. Wire button to create issue with `program_id` pre-filled
3. Enable test

---

## Enabling Tests

When infrastructure is implemented:

1. Remove the `.skip` from the test/describe
2. Run the specific test file to verify it passes
3. Update this document to remove the entry
4. Commit with message referencing the infrastructure PR

Example:
```bash
# After implementing offline persistence
npx playwright test e2e/offline-01-list-cache.spec.ts
```
