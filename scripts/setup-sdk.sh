#!/bin/bash
# Syncs @fpki/auth-client SDK from fpki-validator repo into vendor/
# Runs automatically via preinstall hook, or manually: ./scripts/setup-sdk.sh
#
# Works with both private (if you have access) and public repos.

set -e

REPO_URL="https://github.com/US-Department-of-the-Treasury/fpki-validator.git"
SDK_PATH="packages/auth-client-node"
VENDOR_DIR="vendor/@fpki/auth-client"

# Skip if vendor already exists and has content
if [ -f "$VENDOR_DIR/package.json" ] && [ -d "$VENDOR_DIR/dist" ]; then
  echo "✓ @fpki/auth-client already present in vendor/"
  exit 0
fi

echo "Setting up @fpki/auth-client SDK..."

# Clean up any previous attempts
rm -rf /tmp/fpki-validator-sdk

# Clone repo (shallow for speed)
if ! git clone --depth 1 "$REPO_URL" /tmp/fpki-validator-sdk 2>/dev/null; then
  echo ""
  echo "ERROR: Could not clone fpki-validator repo."
  echo ""
  echo "If the repo is private, ensure you have access via:"
  echo "  - SSH key: git clone git@github.com:US-Department-of-the-Treasury/fpki-validator.git"
  echo "  - HTTPS credential helper configured"
  echo ""
  echo "Or manually copy the SDK to vendor/@fpki/auth-client"
  exit 1
fi

# Create vendor directory structure
mkdir -p "$(dirname "$VENDOR_DIR")"
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"

# Copy only what we need for runtime (dist + package.json)
cp -r "/tmp/fpki-validator-sdk/$SDK_PATH/dist" "$VENDOR_DIR/"
cp "/tmp/fpki-validator-sdk/$SDK_PATH/package.json" "$VENDOR_DIR/"

# Clean up
rm -rf /tmp/fpki-validator-sdk

echo "✓ @fpki/auth-client synced to vendor/"
