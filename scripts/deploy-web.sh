#!/bin/bash
set -euo pipefail

# Ship Frontend Deployment Script
# Deploys the frontend to S3 + CloudFront with automatic cache invalidation
#
# Usage: ./scripts/deploy-web.sh <dev|shadow|prod>
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Terraform outputs available

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse environment argument
ENV="${1:-}"
if [[ ! "$ENV" =~ ^(dev|shadow|prod)$ ]]; then
  echo "Usage: $0 <dev|shadow|prod>"
  echo ""
  echo "Examples:"
  echo "  $0 dev     # Deploy to dev environment"
  echo "  $0 shadow  # Deploy to shadow environment (UAT)"
  echo "  $0 prod    # Deploy to prod environment"
  exit 1
fi

# Environment-specific configuration
if [ "$ENV" = "prod" ]; then
  TF_DIR="$PROJECT_ROOT/terraform"
else
  TF_DIR="$PROJECT_ROOT/terraform/environments/$ENV"
fi

# Sync terraform config from SSM (source of truth)
"$SCRIPT_DIR/sync-terraform-config.sh" "$ENV"

echo "=== Ship Frontend Deploy ==="
echo "Environment: $ENV"

# Get config from Terraform outputs
if [ -d "$TF_DIR" ] && command -v terraform &> /dev/null; then
  S3_BUCKET=$(cd "$TF_DIR" && terraform output -raw s3_bucket_name 2>/dev/null || echo "")
  CF_DISTRIBUTION=$(cd "$TF_DIR" && terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
fi

# Get EB CNAME from terraform.tfvars for WebSocket URL (CloudFront doesn't support WebSocket)
EB_CNAME=$(grep -E '^eb_environment_cname' "$TF_DIR/terraform.tfvars" 2>/dev/null | sed 's/.*= *"\([^"]*\)".*/\1/' || echo "")

S3_BUCKET="${S3_BUCKET:-${DEPLOY_S3_BUCKET:-}}"
CF_DISTRIBUTION="${CF_DISTRIBUTION:-${DEPLOY_CF_DISTRIBUTION:-}}"

if [ -z "$S3_BUCKET" ]; then
  echo "ERROR: S3_BUCKET not found. Run 'terraform apply' in $TF_DIR directory first."
  exit 1
fi

if [ -z "$CF_DISTRIBUTION" ]; then
  echo "ERROR: CloudFront distribution ID not found."
  exit 1
fi

# Always build fresh to ensure we deploy latest code
echo "Building frontend..."
cd "$PROJECT_ROOT"

# Set WebSocket URL to bypass CloudFront (which doesn't support WebSocket)
# The frontend will connect directly to EB for real-time events
if [ -n "$EB_CNAME" ]; then
  echo "WebSocket URL: https://$EB_CNAME"
  export VITE_WS_URL="https://$EB_CNAME"
else
  echo "WARNING: EB_CNAME not found, WebSocket connections may fail through CloudFront"
fi

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
echo "Frontend deployed to $ENV successfully!"
