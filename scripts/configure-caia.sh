#!/bin/bash
set -euo pipefail

# CAIA OAuth Credentials Configuration Script
#
# Configures CAIA OAuth credentials directly in AWS Secrets Manager.
# Use this for:
#   1. Initial setup (before first deployment)
#   2. Recovery (if wrong credentials saved via admin UI)
#
# Usage: ./scripts/configure-caia.sh <dev|prod>
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - jq installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check for jq
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required but not installed."
  echo "Install with: brew install jq"
  exit 1
fi

# Parse environment argument
ENV="${1:-}"
if [[ ! "$ENV" =~ ^(dev|prod)$ ]]; then
  echo "CAIA OAuth Credentials Configuration"
  echo ""
  echo "Usage: $0 <dev|prod>"
  echo ""
  echo "Examples:"
  echo "  $0 dev     # Configure dev environment"
  echo "  $0 prod    # Configure prod environment"
  echo ""
  echo "This script sets CAIA OAuth credentials in AWS Secrets Manager."
  echo "Use it for initial setup or to recover from misconfigured credentials."
  exit 1
fi

# Secret path follows the convention in secrets-manager.ts
SECRET_NAME="/ship/${ENV}/caia-credentials"

echo ""
echo "=== CAIA OAuth Credentials Configuration ==="
echo "Environment: $ENV"
echo "Secret path: $SECRET_NAME"
echo ""

# Check if secret already exists and has a value
EXISTING=""
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" &>/dev/null; then
  EXISTING=$(aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" 2>/dev/null | jq -r '.SecretString // empty' || echo "")

  if [ -n "$EXISTING" ] && [ "$EXISTING" != "{}" ]; then
    EXISTING_ISSUER=$(echo "$EXISTING" | jq -r '.issuer_url // empty')
    EXISTING_CLIENT_ID=$(echo "$EXISTING" | jq -r '.client_id // empty')

    if [ -n "$EXISTING_ISSUER" ] && [ -n "$EXISTING_CLIENT_ID" ]; then
      echo "WARNING: Credentials already configured!"
      echo ""
      echo "Current configuration:"
      echo "  Issuer URL: $EXISTING_ISSUER"
      echo "  Client ID:  $EXISTING_CLIENT_ID"
      echo ""
      read -p "Overwrite existing credentials? (y/N): " CONFIRM
      if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
      fi
      echo ""
    fi
  fi
fi

# Prompt for CAIA environment
echo "Select CAIA environment:"
echo "  1) Development (caia-dev.treasury.gov)"
echo "  2) Acceptance  (caia-acc.treasury.gov)"
echo "  3) Production  (caia.treasury.gov)"
echo ""
read -p "Enter choice [1-3]: " CAIA_ENV_CHOICE

case "$CAIA_ENV_CHOICE" in
  1) ISSUER_URL="https://caia-dev.treasury.gov" ;;
  2) ISSUER_URL="https://caia-acc.treasury.gov" ;;
  3) ISSUER_URL="https://caia.treasury.gov" ;;
  *)
    echo "ERROR: Invalid choice. Enter 1, 2, or 3."
    exit 1
    ;;
esac

echo ""
echo "Selected: $ISSUER_URL"
echo ""

# Prompt for credentials
read -p "Client ID (from CAIA Shield): " CLIENT_ID
if [ -z "$CLIENT_ID" ]; then
  echo "ERROR: Client ID is required."
  exit 1
fi

echo ""
read -sp "Client Secret (from CAIA Shield): " CLIENT_SECRET
echo ""
if [ -z "$CLIENT_SECRET" ]; then
  echo "ERROR: Client Secret is required."
  exit 1
fi

# Build the secret JSON
SECRET_JSON=$(jq -n \
  --arg issuer_url "$ISSUER_URL" \
  --arg client_id "$CLIENT_ID" \
  --arg client_secret "$CLIENT_SECRET" \
  --arg updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg updated_by "configure-caia.sh" \
  '{
    issuer_url: $issuer_url,
    client_id: $client_id,
    client_secret: $client_secret,
    updated_at: $updated_at,
    updated_by: $updated_by
  }')

# Save to Secrets Manager
echo ""
echo "Saving credentials to Secrets Manager..."

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" &>/dev/null; then
  # Secret exists - update it
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "$SECRET_JSON" \
    --no-cli-pager
  echo "Updated existing secret."
else
  # Secret doesn't exist - create it
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --description "CAIA OAuth credentials for PIV authentication ($ENV environment)" \
    --secret-string "$SECRET_JSON" \
    --no-cli-pager
  echo "Created new secret."
fi

echo ""
echo "=== Configuration Complete ==="
echo ""
echo "Credentials saved:"
echo "  Secret path: $SECRET_NAME"
echo "  Issuer URL:  $ISSUER_URL"
echo "  Client ID:   $CLIENT_ID"
echo ""
echo "Next steps:"
if [ "$EXISTING" = "" ] || [ "$EXISTING" = "{}" ]; then
  echo "  1. Deploy your application: ./scripts/deploy.sh $ENV"
  echo "  2. Test PIV login at your application URL"
else
  echo "  1. The app will use new credentials on next auth flow (no restart needed)"
  echo "  2. Test PIV login at your application URL"
fi
echo ""
