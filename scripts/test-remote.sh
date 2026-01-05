#!/bin/bash
#
# Run E2E tests on remote EC2 test runner
#
# Usage:
#   ./scripts/test-remote.sh                    # Run all tests with 96 workers
#   ./scripts/test-remote.sh --workers=48       # Run with fewer workers
#   ./scripts/test-remote.sh --last-failed      # Re-run only failed tests
#   ./scripts/test-remote.sh e2e/auth.spec.ts   # Run specific test file
#
# Prerequisites:
#   1. Deploy test runner: cd terraform/test-runner && terraform apply
#   2. Add SSH config from terraform output to ~/.ssh/config
#

set -e

# Configuration
EC2_HOST="${TEST_RUNNER_HOST:-test-runner}"
REMOTE_DIR="/home/ubuntu/ship"
LOCAL_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DEFAULT_WORKERS=96

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments - extract workers if specified, otherwise use default
WORKERS=$DEFAULT_WORKERS
ARGS=""
for arg in "$@"; do
  if [[ $arg == --workers=* ]]; then
    WORKERS="${arg#--workers=}"
  else
    ARGS="$ARGS $arg"
  fi
done

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Ship E2E Test Runner (Remote)                             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check SSH connection
echo -e "${YELLOW}Checking connection to $EC2_HOST...${NC}"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$EC2_HOST" "echo 'Connected'" 2>/dev/null; then
  echo -e "${RED}Error: Cannot connect to $EC2_HOST${NC}"
  echo ""
  echo "Make sure you have:"
  echo "  1. Deployed the test runner: cd terraform/test-runner && terraform apply"
  echo "  2. Added SSH config from terraform output to ~/.ssh/config"
  echo ""
  echo "SSH config should look like:"
  echo "  Host test-runner"
  echo "    HostName <elastic-ip>"
  echo "    User ubuntu"
  echo "    IdentityFile ~/.ssh/<your-key>.pem"
  exit 1
fi

# Check if setup is complete
echo -e "${YELLOW}Checking if test runner is ready...${NC}"
if ! ssh "$EC2_HOST" "test -f /home/ubuntu/.setup-complete" 2>/dev/null; then
  echo -e "${YELLOW}Test runner is still initializing. Checking setup log...${NC}"
  ssh "$EC2_HOST" "tail -20 /var/log/user-data.log 2>/dev/null || echo 'Setup log not available yet'"
  echo ""
  echo -e "${YELLOW}Wait a few minutes for setup to complete, then try again.${NC}"
  exit 1
fi

# Sync code
echo -e "${YELLOW}Syncing code to EC2...${NC}"
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  --exclude='.env.local' \
  --exclude='*.log' \
  "$LOCAL_DIR/" "$EC2_HOST:$REMOTE_DIR/"

SYNC_SIZE=$(ssh "$EC2_HOST" "du -sh $REMOTE_DIR 2>/dev/null | cut -f1")
echo -e "${GREEN}Synced ($SYNC_SIZE)${NC}"

# Run tests
echo ""
echo -e "${BLUE}Running tests with $WORKERS workers...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

START_TIME=$(date +%s)

# Run tests, stream output
ssh -t "$EC2_HOST" "cd $REMOTE_DIR && \
  export DATABASE_URL='postgresql://ship:ship@localhost:5432/ship_test' && \
  pnpm install --frozen-lockfile --prefer-offline 2>/dev/null && \
  pnpm build 2>&1 | tail -5 && \
  pnpm test:e2e --workers=$WORKERS $ARGS"

EXIT_CODE=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Pull back results
echo -e "${YELLOW}Syncing test results...${NC}"
mkdir -p "$LOCAL_DIR/test-results" "$LOCAL_DIR/playwright-report"
rsync -az "$EC2_HOST:$REMOTE_DIR/test-results/" "$LOCAL_DIR/test-results/" 2>/dev/null || true
rsync -az "$EC2_HOST:$REMOTE_DIR/playwright-report/" "$LOCAL_DIR/playwright-report/" 2>/dev/null || true

# Summary
echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✓ All tests passed!                                       ║${NC}"
  echo -e "${GREEN}║  Duration: ${DURATION}s                                            ${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
else
  echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ✗ Tests failed                                            ║${NC}"
  echo -e "${RED}║  Duration: ${DURATION}s                                            ${NC}"
  echo -e "${RED}║  Results synced to ./test-results/                         ║${NC}"
  echo -e "${RED}║  Report: ./playwright-report/index.html                    ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
fi

exit $EXIT_CODE
