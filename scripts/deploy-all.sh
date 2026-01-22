#!/bin/bash
set -euo pipefail

# =============================================================================
# Ship - Full Stack Deployment
# =============================================================================
# Deploys everything needed for a Ship environment: shared infrastructure,
# environment-specific infrastructure, API, and frontend.
#
# Usage: ./scripts/deploy-all.sh <dev|shadow|prod>
#
# This script is idempotent - safe to run multiple times. It checks what
# already exists and only deploys what's missing.
#
# Deployment order:
#   1. Shared SES infrastructure (domain identity, DKIM) - shared by all envs
#   2. Environment infrastructure (VPC, Aurora, EB, CloudFront, SES endpoint)
#   3. API deployment to Elastic Beanstalk
#   4. Frontend deployment to CloudFront/S3
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_step() { echo -e "\n${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Parse environment argument
ENV="${1:-}"
if [[ ! "$ENV" =~ ^(dev|shadow|prod)$ ]]; then
  echo "Usage: $0 <dev|shadow|prod>"
  echo ""
  echo "Full stack deployment for Ship environments."
  echo ""
  echo "Examples:"
  echo "  $0 dev     # Deploy everything to dev"
  echo "  $0 shadow  # Deploy everything to shadow (UAT)"
  echo "  $0 prod    # Deploy everything to prod"
  echo ""
  echo "This script will:"
  echo "  1. Deploy shared SES infrastructure (if not exists)"
  echo "  2. Deploy environment infrastructure (if not exists)"
  echo "  3. Deploy API to Elastic Beanstalk"
  echo "  4. Deploy frontend to CloudFront/S3"
  exit 1
fi

echo "=============================================="
echo " Ship - Full Stack Deployment"
echo " Environment: $ENV"
echo "=============================================="

# -----------------------------------------------------------------------------
# Step 1: Check/Deploy Shared SES Infrastructure
# -----------------------------------------------------------------------------
log_step "Step 1: Shared SES Infrastructure"

# Check if shared SES has been deployed by looking for the domain-arn SSM parameter
SES_DOMAIN_ARN=$(aws ssm get-parameter --name /ship/ses/domain-arn --query 'Parameter.Value' --output text 2>/dev/null || echo "")

if [ -n "$SES_DOMAIN_ARN" ]; then
  log_success "Shared SES already deployed (domain-arn: $SES_DOMAIN_ARN)"
else
  log_warning "Shared SES not deployed - will create now"

  SHARED_SES_DIR="$PROJECT_ROOT/terraform/shared/ses"

  # Check if tfvars exists
  if [ ! -f "$SHARED_SES_DIR/terraform.tfvars" ]; then
    log_step "Generating shared/ses terraform.tfvars from SSM..."

    SES_DOMAIN=$(aws ssm get-parameter --name /ship/ses/domain --query 'Parameter.Value' --output text 2>/dev/null || echo "ship.awsdev.treasury.gov")
    ROUTE53_ZONE_ID=$(aws ssm get-parameter --name /ship/ses/route53_zone_id --query 'Parameter.Value' --output text 2>/dev/null || echo "")

    if [ -z "$ROUTE53_ZONE_ID" ]; then
      log_error "SSM parameter /ship/ses/route53_zone_id not found"
      echo "Set it with: aws ssm put-parameter --name /ship/ses/route53_zone_id --value YOUR_ZONE_ID --type String"
      exit 1
    fi

    cat > "$SHARED_SES_DIR/terraform.tfvars" << EOF
# Auto-generated from SSM Parameter Store
# Source: /ship/ses/*
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

aws_region      = "us-east-1"
ses_domain      = "$SES_DOMAIN"
route53_zone_id = "$ROUTE53_ZONE_ID"
EOF
    log_success "Generated terraform.tfvars"
  fi

  cd "$SHARED_SES_DIR"

  echo ""
  echo "About to deploy shared SES infrastructure:"
  echo "  - SES domain identity: ship.awsdev.treasury.gov"
  echo "  - Easy DKIM (2048-bit keys)"
  echo "  - Route53 DKIM CNAME records"
  echo ""
  read -p "Continue with shared SES deployment? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_error "Deployment cancelled by user"
    exit 1
  fi

  log_step "Initializing shared/ses terraform..."
  terraform init

  log_step "Planning shared/ses changes..."
  terraform plan -out=tfplan

  log_step "Applying shared/ses infrastructure..."
  terraform apply tfplan
  rm -f tfplan

  log_success "Shared SES infrastructure deployed"
  cd "$PROJECT_ROOT"
fi

# -----------------------------------------------------------------------------
# Step 2: Check/Deploy Environment Infrastructure
# -----------------------------------------------------------------------------
log_step "Step 2: Environment Infrastructure ($ENV)"

# Environment-specific paths
if [ "$ENV" = "prod" ]; then
  TF_DIR="$PROJECT_ROOT/terraform"
else
  TF_DIR="$PROJECT_ROOT/terraform/environments/$ENV"
fi

# Check if environment infrastructure exists by looking for EB environment
EB_ENV_NAME="ship-api-${ENV}"
if [ "$ENV" = "prod" ]; then
  EB_ENV_NAME="ship-api-prod"
fi

EB_STATUS=$(aws elasticbeanstalk describe-environments \
  --environment-names "$EB_ENV_NAME" \
  --query 'Environments[0].Status' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$EB_STATUS" != "NOT_FOUND" ] && [ "$EB_STATUS" != "None" ]; then
  log_success "Environment infrastructure exists (EB status: $EB_STATUS)"
else
  log_warning "Environment infrastructure not found - will create now"

  # Sync terraform config from SSM
  log_step "Syncing terraform config from SSM..."
  "$SCRIPT_DIR/sync-terraform-config.sh" "$ENV"

  # Add SES variables to tfvars if not present
  TFVARS_FILE="$TF_DIR/terraform.tfvars"
  if ! grep -q "ses_from_email" "$TFVARS_FILE" 2>/dev/null; then
    log_step "Adding SES configuration to tfvars..."

    # Determine from email based on environment
    case "$ENV" in
      prod)   FROM_EMAIL="noreply@ship.awsdev.treasury.gov"; FROM_NAME="Ship" ;;
      shadow) FROM_EMAIL="noreply-shadow@ship.awsdev.treasury.gov"; FROM_NAME="Ship (Shadow)" ;;
      dev)    FROM_EMAIL="noreply-dev@ship.awsdev.treasury.gov"; FROM_NAME="Ship (Dev)" ;;
    esac

    echo "" >> "$TFVARS_FILE"
    echo "# SES Email Configuration" >> "$TFVARS_FILE"
    echo "ses_from_email = \"$FROM_EMAIL\"" >> "$TFVARS_FILE"
    echo "ses_from_name  = \"$FROM_NAME\"" >> "$TFVARS_FILE"

    log_success "Added SES config to tfvars"
  fi

  cd "$TF_DIR"

  echo ""
  echo "About to deploy $ENV environment infrastructure:"
  echo "  - VPC with public/private subnets"
  echo "  - Aurora Serverless v2 PostgreSQL"
  echo "  - Elastic Beanstalk application"
  echo "  - CloudFront + S3 for frontend"
  echo "  - SES VPC endpoint"
  echo "  - IAM roles and security groups"
  echo ""
  read -p "Continue with $ENV infrastructure deployment? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_error "Deployment cancelled by user"
    exit 1
  fi

  # Get state bucket for init
  STATE_BUCKET=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query 'Parameter.Value' --output text 2>/dev/null || echo "")

  log_step "Initializing $ENV terraform..."
  if [ -n "$STATE_BUCKET" ]; then
    terraform init -backend-config="bucket=$STATE_BUCKET"
  else
    terraform init
  fi

  log_step "Planning $ENV infrastructure changes..."
  terraform plan -out=tfplan

  log_step "Applying $ENV infrastructure..."
  terraform apply tfplan
  rm -f tfplan

  log_success "Environment infrastructure deployed"
  cd "$PROJECT_ROOT"
fi

# -----------------------------------------------------------------------------
# Step 3: Deploy API
# -----------------------------------------------------------------------------
log_step "Step 3: API Deployment"

echo ""
read -p "Deploy API to Elastic Beanstalk? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  "$SCRIPT_DIR/deploy.sh" "$ENV"
  log_success "API deployed"
else
  log_warning "Skipped API deployment"
fi

# -----------------------------------------------------------------------------
# Step 4: Deploy Frontend
# -----------------------------------------------------------------------------
log_step "Step 4: Frontend Deployment"

echo ""
read -p "Deploy frontend to CloudFront/S3? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  "$SCRIPT_DIR/deploy-web.sh" "$ENV"
  log_success "Frontend deployed"
else
  log_warning "Skipped frontend deployment"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "=============================================="
echo " Deployment Complete!"
echo "=============================================="
echo ""
echo "Environment: $ENV"

# Get the app URL
APP_URL=$(aws ssm get-parameter --name "/ship/$ENV/APP_BASE_URL" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
if [ -n "$APP_URL" ]; then
  echo "URL: $APP_URL"
fi

echo ""
echo "Monitor EB health:"
echo "  aws elasticbeanstalk describe-environments --environment-names $EB_ENV_NAME"
echo ""
