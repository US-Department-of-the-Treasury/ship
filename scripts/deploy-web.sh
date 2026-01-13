#!/bin/bash
set -euo pipefail

# Ship Frontend Deployment Script
# Deploys the frontend to S3 + CloudFront with automatic cache invalidation
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform outputs available

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Sync terraform config from SSM (source of truth)
"$SCRIPT_DIR/sync-terraform-config.sh"

echo "=== Ship Frontend Deploy ==="

# Get config from Terraform outputs
if [ -d "terraform" ] && command -v terraform &> /dev/null; then
  S3_BUCKET=$(cd terraform && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
  CF_DISTRIBUTION=$(cd terraform && terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
fi

S3_BUCKET="${S3_BUCKET:-${DEPLOY_S3_BUCKET:-}}"
CF_DISTRIBUTION="${CF_DISTRIBUTION:-${DEPLOY_CF_DISTRIBUTION:-}}"

if [ -z "$S3_BUCKET" ]; then
  echo "ERROR: S3_BUCKET not found. Run 'terraform apply' in terraform/ directory first."
  exit 1
fi

if [ -z "$CF_DISTRIBUTION" ]; then
  echo "ERROR: CloudFront distribution ID not found."
  exit 1
fi

# Always build fresh to ensure we deploy latest code
echo "Building frontend..."
pnpm build:web

echo "Syncing to S3: $S3_BUCKET"
aws s3 sync web/dist/ "s3://${S3_BUCKET}/" --delete

echo "Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "Invalidation started: $INVALIDATION_ID"

# Wait for invalidation to complete (optional but recommended)
echo "Waiting for invalidation to complete..."
aws cloudfront wait invalidation-completed \
  --distribution-id "$CF_DISTRIBUTION" \
  --id "$INVALIDATION_ID"

echo ""
echo "Frontend deployed successfully!"
