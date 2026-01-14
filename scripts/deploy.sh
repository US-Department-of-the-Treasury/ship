#!/bin/bash
set -euo pipefail

# Ship API Deployment Script
# Deploys the API to Elastic Beanstalk for the specified environment
#
# Usage: ./scripts/deploy.sh <dev|prod>
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform infrastructure deployed for the target environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse environment argument
ENV="${1:-}"
if [[ ! "$ENV" =~ ^(dev|prod)$ ]]; then
  echo "Usage: $0 <dev|prod>"
  echo ""
  echo "Examples:"
  echo "  $0 dev     # Deploy to dev environment"
  echo "  $0 prod    # Deploy to prod environment"
  exit 1
fi

# Environment-specific configuration
# - prod uses existing terraform at root with original app name (ship-api)
# - dev uses new modular structure with environment-suffixed app name
if [ "$ENV" = "prod" ]; then
  TF_DIR="$PROJECT_ROOT/terraform"
  APP_NAME="ship-api"
  ENV_NAME="ship-api-prod"
else
  TF_DIR="$PROJECT_ROOT/terraform/environments/$ENV"
  APP_NAME="ship-api-${ENV}"
  ENV_NAME="ship-api-${ENV}"
fi

# Sync terraform config from SSM (source of truth for this environment)
"$SCRIPT_DIR/sync-terraform-config.sh" "$ENV"

VERSION="v$(date +%Y%m%d%H%M%S)"

# Get S3 bucket from Terraform outputs
if [ -d "$TF_DIR" ] && command -v terraform &> /dev/null; then
  S3_BUCKET=$(cd "$TF_DIR" && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
fi
S3_BUCKET="${S3_BUCKET:-${DEPLOY_S3_BUCKET:-}}"

if [ -z "$S3_BUCKET" ]; then
  echo "ERROR: S3_BUCKET not found. Either:"
  echo "  1. Run 'terraform apply' in terraform/environments/$ENV/ directory"
  echo "  2. Set DEPLOY_S3_BUCKET environment variable"
  exit 1
fi

echo "=== Ship API Deploy ==="
echo "Environment: $ENV"
echo "Version: $VERSION"
echo "EB Environment: $ENV_NAME"

# ALWAYS rebuild for 100% reliable deploys
# The api/package.json build script copies SQL files automatically
echo "Building..."
cd "$PROJECT_ROOT"
rm -rf shared/dist shared/tsconfig.tsbuildinfo api/dist api/tsconfig.tsbuildinfo
pnpm build:shared && pnpm build:api

# Verify SQL files are present (fail fast if missing)
if [ ! -f "api/dist/db/schema.sql" ]; then
  echo "ERROR: schema.sql not found in api/dist/db/"
  exit 1
fi
if [ ! -d "api/dist/db/migrations" ]; then
  echo "ERROR: migrations directory not found in api/dist/db/"
  exit 1
fi

# Verify all migrations were copied (compare counts)
SRC_COUNT=$(ls -1 api/src/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
DIST_COUNT=$(ls -1 api/dist/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$SRC_COUNT" != "$DIST_COUNT" ]; then
  echo "ERROR: Migration count mismatch! src=$SRC_COUNT, dist=$DIST_COUNT"
  exit 1
fi
echo "✓ SQL files verified ($DIST_COUNT migrations)"

# CRITICAL: Test Docker build BEFORE deploying
# This catches dependency issues that only manifest in production (--prod install)
echo "Testing Docker build locally..."
if ! docker build -t ship-api:pre-deploy-test . --quiet 2>/dev/null; then
  echo ""
  echo "============================================"
  echo "ERROR: Docker build FAILED"
  echo "============================================"
  echo "This would have crashed production!"
  echo ""
  echo "Common causes:"
  echo "  - Dependency in devDependencies that should be in dependencies"
  echo "  - Missing package in package.json"
  echo "  - Dockerfile syntax error"
  echo ""
  echo "Debug: docker build -t ship-api:debug ."
  echo "============================================"
  exit 1
fi

# Verify container can start and imports work
# Provide minimal env vars for import test (actual values come from EB environment)
echo "Verifying container starts..."
IMPORT_TEST=$(docker run --rm \
  -e SESSION_SECRET=test-secret-for-import-check \
  -e DATABASE_URL=postgres://test:test@localhost/test \
  ship-api:pre-deploy-test node -e "
  import('./dist/app.js')
    .then(() => { console.log('OK'); process.exit(0); })
    .catch(e => { console.error('FAIL:', e.message); process.exit(1); })
" 2>&1)

if [ "$IMPORT_TEST" != "OK" ]; then
  echo ""
  echo "============================================"
  echo "ERROR: Container failed to start"
  echo "============================================"
  echo "$IMPORT_TEST"
  echo ""
  echo "The container built but crashed on import."
  echo "This usually means a runtime dependency is missing."
  echo ""
  echo "Debug: docker run -it ship-api:pre-deploy-test sh"
  echo "============================================"
  exit 1
fi
echo "✓ Docker build and import test passed"

# Create deployment bundle
# Dockerfile is at repo root, EB finds it automatically
BUNDLE="/tmp/api-${VERSION}.zip"
zip -r "$BUNDLE" \
  Dockerfile \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  api/dist \
  api/package.json \
  shared/dist \
  shared/package.json \
  -x "*.git*"

echo "Bundle: $BUNDLE"
echo "Contents:"
unzip -l "$BUNDLE" | grep -E "^Archive|Dockerfile|package.json" | head -10

# Upload and deploy
aws s3 cp "$BUNDLE" "s3://${S3_BUCKET}/deploy/api-${VERSION}.zip"

aws elasticbeanstalk create-application-version \
  --application-name "$APP_NAME" \
  --version-label "$VERSION" \
  --source-bundle S3Bucket="$S3_BUCKET",S3Key="deploy/api-${VERSION}.zip" \
  --no-cli-pager

aws elasticbeanstalk update-environment \
  --environment-name "$ENV_NAME" \
  --version-label "$VERSION" \
  --no-cli-pager

echo ""
echo "Deployed $VERSION to $ENV_NAME"
echo "Monitor: aws elasticbeanstalk describe-environments --environment-names $ENV_NAME --query 'Environments[0].[Health,HealthStatus]'"
