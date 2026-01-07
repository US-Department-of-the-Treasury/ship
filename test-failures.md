# Failing E2E Tests Analysis

Generated: $(date)

**Summary: 15 failing tests across 6 categories**

## Categories

### 1. Program Tabs - Feedback Tab Not Found (4 tests)
Tests expect a "Feedback" tab in program editor that may have been renamed/removed:
- programs.spec__program_editor_has_tabbed_navigation__Overview__Is
- programs.spec__can_switch_between_program_tabs
- programs.spec__can_give_feedback_from_program_Feedback_tab
- programs.spec__Feedback_tab_shows_filter_options

**Fix**: Check if Feedback tab exists or update tests to match current UI

### 2. Context Menu Tests (3 tests)
Right-click context menu not appearing:
- issues-bulk-operations.spec__can_right_click_to_open_context_menu
- issues-bulk-operations.spec__can_archive_an_issue_via_context_menu  
- issues-bulk-operations.spec__context_menu_shows_change_status_option

**Fix**: Verify context menu implementation and aria-label

### 3. Offline Tests (3 tests)
Offline functionality issues:
- offline-07-session-handling.spec__app_remains_usable_offline_even_with_expired_sessi
- offline-07-session-handling.spec__session_expiry_during_offline_does_not_lose_local_
- offline-08-websocket.spec__WebSocket_reconnects_automatically_when_online
- offline-11-multi-tab.spec__changes_in_one_offline_tab_appear_in_another_offli

**Fix**: Review offline implementation and sync status text ("SavedSaved" duplicate)

### 4. Security Test (1 test)
- security.spec__authenticated_routes_require_auth
Expected redirect to /login but got /projects - possible test isolation issue

**Fix**: Check test setup/teardown for session leakage

### 5. Race Conditions (1 test)
- race-conditions.spec__concurrent_edits_in_same_location_converge
Editor content empty when expected "Initial text" - timing issue

**Fix**: Add wait for content or increase timeout

### 6. UI Element Tests (2 tests)
- accessibility-remediation.spec__draggable_issues_can_be_moved_with_keyboard
- program-mode-sprint-ux.spec__issues_table_has_checkbox_column_for_bulk_selectio

**Fix**: Verify UI elements exist and have correct selectors
