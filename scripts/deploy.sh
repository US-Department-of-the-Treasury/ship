#!/bin/bash
set -euo pipefail

# Ship API Deployment Script
# Deploys the API to Elastic Beanstalk
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform outputs available (run from terraform/ directory first if needed)

VERSION="v$(date +%Y%m%d%H%M%S)"

# Get config from Terraform outputs or environment
if [ -d "terraform" ] && command -v terraform &> /dev/null; then
  S3_BUCKET=$(cd terraform && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
fi
S3_BUCKET="${S3_BUCKET:-${DEPLOY_S3_BUCKET:-}}"

if [ -z "$S3_BUCKET" ]; then
  echo "ERROR: S3_BUCKET not found. Either:"
  echo "  1. Run 'terraform output' in terraform/ directory"
  echo "  2. Set DEPLOY_S3_BUCKET environment variable"
  exit 1
fi

APP_NAME="${DEPLOY_APP_NAME:-ship-api}"
ENV_NAME="${DEPLOY_ENV_NAME:-ship-api-prod}"

echo "=== Ship API Deploy ==="
echo "Version: $VERSION"

# ALWAYS rebuild for 100% reliable deploys
# The api/package.json build script copies SQL files automatically
echo "Building..."
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
