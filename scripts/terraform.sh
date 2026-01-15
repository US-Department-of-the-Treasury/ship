#!/bin/bash
set -euo pipefail

# Terraform wrapper script for multi-environment deployment
# Automatically changes to the correct environment directory and syncs config from SSM
#
# Usage: ./scripts/terraform.sh <dev|prod> <terraform command>
#
# Examples:
#   ./scripts/terraform.sh dev init
#   ./scripts/terraform.sh dev plan
#   ./scripts/terraform.sh dev apply
#   ./scripts/terraform.sh prod output -raw s3_bucket_name

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse environment argument
ENV="${1:-}"
if [[ ! "$ENV" =~ ^(dev|prod)$ ]]; then
  echo "Usage: $0 <dev|prod> <terraform command>"
  echo ""
  echo "Examples:"
  echo "  $0 dev init              # Initialize dev environment"
  echo "  $0 dev plan              # Plan changes for dev"
  echo "  $0 dev apply             # Apply changes to dev"
  echo "  $0 prod output           # Show prod outputs"
  exit 1
fi
shift

# Check that terraform command was provided
if [ $# -eq 0 ]; then
  echo "ERROR: No terraform command specified"
  echo "Usage: $0 <dev|prod> <terraform command>"
  exit 1
fi

# Environment-specific terraform directory
# - prod uses existing monolithic terraform at root (existing state, no migration needed)
# - dev uses new modular structure
if [ "$ENV" = "prod" ]; then
  TF_DIR="$PROJECT_ROOT/terraform"
else
  TF_DIR="$PROJECT_ROOT/terraform/environments/$ENV"
fi

# Verify environment directory exists
if [ ! -d "$TF_DIR" ]; then
  echo "ERROR: Environment directory not found: $TF_DIR"
  echo "Run the module extraction and environment setup first."
  exit 1
fi

# Sync terraform config from SSM before any terraform operation (except init)
# This ensures tfvars are always up to date
if [ "$1" != "init" ]; then
  echo "Syncing terraform config from SSM..."
  "$SCRIPT_DIR/sync-terraform-config.sh" "$ENV" || {
    echo "WARNING: Could not sync from SSM. Using existing tfvars if present."
  }
fi

# Change to environment directory and run terraform
cd "$TF_DIR"
echo "Running: terraform $* (in $TF_DIR)"
echo ""

# For init, we need to pass the backend bucket from SSM
if [ "$1" = "init" ]; then
  STATE_BUCKET=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query 'Parameter.Value' --output text 2>/dev/null || echo "")
  if [ -n "$STATE_BUCKET" ]; then
    echo "Using state bucket: $STATE_BUCKET"
    terraform init -backend-config="bucket=$STATE_BUCKET" "${@:2}"
  else
    echo "WARNING: /ship/terraform-state-bucket SSM parameter not found"
    echo "Running terraform init without backend config..."
    terraform "$@"
  fi
else
  terraform "$@"
fi
