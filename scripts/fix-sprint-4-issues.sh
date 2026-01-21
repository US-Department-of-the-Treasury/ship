#!/bin/bash
# Fix Sprint 4 Issues - Set sprint_id on issues that belong to Sprint 4
#
# Context: Issues were created with sprint_id=null due to a bug in the /prd skill
# that didn't properly persist variables between bash blocks.
#
# Sprint 4 ID: b9a144d0-cdcb-495a-a1b1-63a29a4b62ee
# Program ID: ece76b1c-f736-45d8-be22-8f88da51cf14
#
# Usage:
#   ./scripts/fix-sprint-4-issues.sh
#
# Requires: SHIP_API_TOKEN in ~/.claude/.env

set -e

# Load Ship configuration
source ~/.claude/.env 2>/dev/null || true
SHIP_URL=${SHIP_URL:-"https://ship.awsdev.treasury.gov"}

if [ -z "$SHIP_API_TOKEN" ]; then
  echo "ERROR: SHIP_API_TOKEN not set. Run /ship:auth first."
  exit 1
fi

SPRINT_ID="b9a144d0-cdcb-495a-a1b1-63a29a4b62ee"
PROGRAM_ID="ece76b1c-f736-45d8-be22-8f88da51cf14"

echo "=== Fixing Sprint 4 Issues ==="
echo "Sprint ID: $SPRINT_ID"
echo "Program ID: $PROGRAM_ID"
echo "Ship URL: $SHIP_URL"
echo ""

# Validate API token
echo "Validating API token..."
AUTH_RESPONSE=$(curl -s "$SHIP_URL/api/auth/me" -H "Authorization: Bearer $SHIP_API_TOKEN")
if echo "$AUTH_RESPONSE" | jq -e '.success == false' >/dev/null 2>&1; then
  echo "ERROR: API token is invalid"
  echo "$AUTH_RESPONSE"
  exit 1
fi
USER_NAME=$(echo "$AUTH_RESPONSE" | jq -r '.data.user.name // .data.user.email // "Unknown"')
echo "Authenticated as: $USER_NAME"
echo ""

# Get all issues that need to be fixed
# These are issues with sprint_id=null that should belong to Sprint 4
# We identify them by their titles from the Sprint 4 PRD
echo "Fetching issues with null sprint_id..."
ALL_ISSUES=$(curl -s "$SHIP_URL/api/issues?limit=200" -H "Authorization: Bearer $SHIP_API_TOKEN")

if echo "$ALL_ISSUES" | jq -e '.success == false' >/dev/null 2>&1; then
  echo "ERROR: Failed to fetch issues"
  echo "$ALL_ISSUES"
  exit 1
fi

# Filter issues that have null sprint_id
NULL_SPRINT_ISSUES=$(echo "$ALL_ISSUES" | jq '[.[] | select(.sprint_id == null)]')
NULL_COUNT=$(echo "$NULL_SPRINT_ISSUES" | jq 'length')
echo "Found $NULL_COUNT issues with null sprint_id"

if [ "$NULL_COUNT" -eq 0 ]; then
  echo "No issues need fixing!"
  exit 0
fi

echo ""
echo "Issues to fix:"
echo "$NULL_SPRINT_ISSUES" | jq -r '.[] | "  - #\(.ticket_number // "?"): \(.title)"'
echo ""

# Confirm before proceeding
read -p "Fix $NULL_COUNT issues by setting sprint_id=$SPRINT_ID? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Fixing issues..."

FIXED=0
FAILED=0

for ISSUE_ID in $(echo "$NULL_SPRINT_ISSUES" | jq -r '.[].id'); do
  ISSUE_TITLE=$(echo "$NULL_SPRINT_ISSUES" | jq -r --arg id "$ISSUE_ID" '.[] | select(.id == $id) | .title')

  RESPONSE=$(curl -s -X PATCH "$SHIP_URL/api/issues/$ISSUE_ID" \
    -H "Authorization: Bearer $SHIP_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sprint_id\": \"$SPRINT_ID\", \"program_id\": \"$PROGRAM_ID\"}")

  if echo "$RESPONSE" | jq -e '.id' >/dev/null 2>&1; then
    echo "✓ Fixed: $ISSUE_TITLE"
    ((FIXED++))
  else
    echo "✗ Failed: $ISSUE_TITLE"
    echo "  Response: $RESPONSE"
    ((FAILED++))
  fi
done

echo ""
echo "=== Summary ==="
echo "Fixed: $FIXED"
echo "Failed: $FAILED"

# Verify the fix
echo ""
echo "Verifying sprint issue count..."
SPRINT_INFO=$(curl -s "$SHIP_URL/api/sprints/$SPRINT_ID" -H "Authorization: Bearer $SHIP_API_TOKEN")
ISSUE_COUNT=$(echo "$SPRINT_INFO" | jq -r '.issue_count // 0')
echo "Sprint 4 now has $ISSUE_COUNT issues"
