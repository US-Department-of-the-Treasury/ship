#!/bin/bash
set -e

echo "=========================================="
echo "Ship - API Deployment"
echo "=========================================="
echo ""

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Configuration
APP_NAME="${EB_APP_NAME:-ship-api}"
ENV_NAME="${EB_ENV_NAME:-ship-api-dev}"
S3_BUCKET="${EB_S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
VERSION_LABEL="ship-api-$(date +%Y%m%d-%H%M%S)"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    echo "Install with: brew install awscli"
    exit 1
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    echo "Install with: npm install -g pnpm"
    exit 1
fi

# Find S3 bucket if not specified
if [ -z "$S3_BUCKET" ]; then
    echo "Looking for EB S3 bucket..."
    S3_BUCKET=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, 'elasticbeanstalk-${AWS_REGION}')].Name | [0]" --output text 2>/dev/null || true)

    if [ -z "$S3_BUCKET" ] || [ "$S3_BUCKET" = "None" ]; then
        echo "Error: Could not find Elastic Beanstalk S3 bucket"
        echo "Set EB_S3_BUCKET environment variable or ensure EB is configured"
        exit 1
    fi
    echo "Found bucket: $S3_BUCKET"
fi

echo ""
echo "Step 1: Building shared package..."
echo "-----------------------------------"
cd "$PROJECT_ROOT/shared"
pnpm build
echo "Shared package built successfully"

echo ""
echo "Step 2: Building API package..."
echo "-----------------------------------"
cd "$PROJECT_ROOT/api"
pnpm build
echo "API package built successfully"

echo ""
echo "Step 3: Creating deployment package..."
echo "-----------------------------------"

# Create temporary directory for deployment package
DEPLOY_DIR=$(mktemp -d)
trap "rm -rf $DEPLOY_DIR" EXIT

# Copy Dockerfile to root (required by EB Docker platform)
cp "$PROJECT_ROOT/api/Dockerfile" "$DEPLOY_DIR/Dockerfile"

# Copy root package files
cp "$PROJECT_ROOT/package.json" "$DEPLOY_DIR/"
cp "$PROJECT_ROOT/pnpm-lock.yaml" "$DEPLOY_DIR/"
cp "$PROJECT_ROOT/pnpm-workspace.yaml" "$DEPLOY_DIR/"

# Create directory structure and copy built packages
mkdir -p "$DEPLOY_DIR/api/dist"
mkdir -p "$DEPLOY_DIR/shared/dist"

# Copy api package.json and built dist
cp "$PROJECT_ROOT/api/package.json" "$DEPLOY_DIR/api/"
cp -r "$PROJECT_ROOT/api/dist/"* "$DEPLOY_DIR/api/dist/"

# Copy shared package.json and built dist
cp "$PROJECT_ROOT/shared/package.json" "$DEPLOY_DIR/shared/"
cp -r "$PROJECT_ROOT/shared/dist/"* "$DEPLOY_DIR/shared/dist/"

# Create the deployment ZIP
ZIP_FILE="$PROJECT_ROOT/deploy-api-${VERSION_LABEL}.zip"
cd "$DEPLOY_DIR"
zip -r "$ZIP_FILE" . -x "*.DS_Store" -x "__MACOSX/*"
echo "Created deployment package: $ZIP_FILE"

echo ""
echo "Step 4: Uploading to S3..."
echo "-----------------------------------"
S3_KEY="$APP_NAME/$VERSION_LABEL.zip"
aws s3 cp "$ZIP_FILE" "s3://$S3_BUCKET/$S3_KEY"
echo "Uploaded to s3://$S3_BUCKET/$S3_KEY"

echo ""
echo "Step 5: Creating application version..."
echo "-----------------------------------"
aws elasticbeanstalk create-application-version \
    --application-name "$APP_NAME" \
    --version-label "$VERSION_LABEL" \
    --source-bundle S3Bucket="$S3_BUCKET",S3Key="$S3_KEY" \
    --region "$AWS_REGION" \
    --no-cli-pager
echo "Created application version: $VERSION_LABEL"

echo ""
echo "Step 6: Deploying to environment..."
echo "-----------------------------------"
aws elasticbeanstalk update-environment \
    --application-name "$APP_NAME" \
    --environment-name "$ENV_NAME" \
    --version-label "$VERSION_LABEL" \
    --region "$AWS_REGION" \
    --no-cli-pager
echo "Deployment initiated"

echo ""
echo "Step 7: Waiting for deployment to complete..."
echo "-----------------------------------"
echo "This may take 3-5 minutes..."

# Wait for environment to be ready
aws elasticbeanstalk wait environment-updated \
    --application-name "$APP_NAME" \
    --environment-name "$ENV_NAME" \
    --region "$AWS_REGION"

# Check final status
STATUS=$(aws elasticbeanstalk describe-environments \
    --application-name "$APP_NAME" \
    --environment-names "$ENV_NAME" \
    --query "Environments[0].Status" \
    --output text \
    --region "$AWS_REGION")

HEALTH=$(aws elasticbeanstalk describe-environments \
    --application-name "$APP_NAME" \
    --environment-names "$ENV_NAME" \
    --query "Environments[0].Health" \
    --output text \
    --region "$AWS_REGION")

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Environment: $ENV_NAME"
echo "Version: $VERSION_LABEL"
echo "Status: $STATUS"
echo "Health: $HEALTH"
echo ""

# Clean up local ZIP
rm -f "$ZIP_FILE"

if [ "$HEALTH" = "Green" ]; then
    echo "Deployment successful!"
    exit 0
else
    echo "Warning: Environment health is $HEALTH"
    echo "Check logs with: aws elasticbeanstalk request-environment-info --environment-name $ENV_NAME --info-type tail"
    exit 1
fi
