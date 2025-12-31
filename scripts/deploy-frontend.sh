#!/bin/bash
set -e

echo "=========================================="
echo "Ship - Frontend Deployment"
echo "=========================================="
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Get S3 bucket name and CloudFront distribution ID from Terraform
BUCKET_NAME=$(cd terraform && terraform output -raw s3_bucket_name)
DISTRIBUTION_ID=$(cd terraform && terraform output -raw cloudfront_distribution_id)
FRONTEND_URL=$(cd terraform && terraform output -raw frontend_url)

if [ -z "$BUCKET_NAME" ] || [ -z "$DISTRIBUTION_ID" ]; then
    echo "Error: Could not get infrastructure details from Terraform"
    echo "Make sure you've deployed infrastructure first: ./scripts/deploy-infrastructure.sh"
    exit 1
fi

echo "Building frontend..."
pnpm build:web

echo ""
echo "Deploying to S3 bucket: $BUCKET_NAME"
aws s3 sync web/dist/ "s3://${BUCKET_NAME}" --delete --cache-control "public,max-age=31536000,immutable"

# Upload index.html separately with shorter cache for SPA routing
aws s3 cp web/dist/index.html "s3://${BUCKET_NAME}/index.html" --cache-control "public,max-age=300"

echo ""
echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"

echo ""
echo "=========================================="
echo "Frontend deployment complete!"
echo "=========================================="
echo ""
echo "Frontend URL: $FRONTEND_URL"
echo ""
echo "Note: CloudFront invalidation may take 1-2 minutes to complete"
