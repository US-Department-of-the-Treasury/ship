#!/bin/bash
# Generate TLS certificates for local HTTP/2 development.
# Certs are stored in scripts/certs/ and gitignored.
#
# Priority:
# 1) mkcert certificate (trusted by local OS/browser trust store)
# 2) OpenSSL self-signed fallback (may be blocked by strict browser policies)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/certs"
KEY_PATH="$CERT_DIR/localhost-key.pem"
CERT_PATH="$CERT_DIR/localhost.pem"

mkdir -p "$CERT_DIR"

generate_mkcert() {
  echo "[certs] Generating locally-trusted cert with mkcert..."
  mkcert -cert-file "$CERT_PATH" \
         -key-file "$KEY_PATH" \
         localhost 127.0.0.1 ::1
}

generate_openssl() {
  echo "[certs] Generating self-signed cert with openssl..."
  echo "[certs] Chrome/Safari may reject untrusted localhost certs."
  echo "[certs] Recommended: brew install mkcert && mkcert -install"
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
    -subj '/CN=localhost' \
    -keyout "$KEY_PATH" \
    -out "$CERT_PATH" \
    -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1' \
    2>/dev/null
}

have_existing_cert=false
if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
  have_existing_cert=true
fi

if command -v mkcert &>/dev/null; then
  # Replace non-mkcert certs so browsers trust localhost without manual overrides.
  if [ "$have_existing_cert" = true ]; then
    issuer="$(openssl x509 -in "$CERT_PATH" -noout -issuer 2>/dev/null || true)"
    if echo "$issuer" | grep -qi "mkcert"; then
      exit 0
    fi
    echo "[certs] Existing cert is not mkcert-signed. Replacing with trusted mkcert cert."
  fi
  generate_mkcert
  exit 0
fi

# mkcert is not available.
# Keep existing cert if present; otherwise create OpenSSL fallback.
if [ "$have_existing_cert" = true ]; then
  issuer="$(openssl x509 -in "$CERT_PATH" -noout -issuer 2>/dev/null || true)"
  echo "[certs] Reusing existing cert ($issuer)"
  echo "[certs] For trusted certs: brew install mkcert && mkcert -install"
  exit 0
fi

generate_openssl
