#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

REPO_ROOT="$(cd .. && pwd)"
PRODUCT_NAME="Ensign"
VERSION="$(node -p "require('./package.json').version")"

echo "=== Ensign Distribution Build ==="
echo "Version: ${VERSION}"
echo ""

# --- Build, sign, and notarize ---
npm run build:mac:signed

# --- Find the DMG ---
if [[ -d "release/mac-arm64/${PRODUCT_NAME}.app" ]]; then
  ARCH="arm64"
elif [[ -d "release/mac-x64/${PRODUCT_NAME}.app" ]]; then
  ARCH="x64"
else
  echo "distribute: no app bundle found" >&2
  exit 1
fi

DMG_PATH="release/${PRODUCT_NAME}-${VERSION}-${ARCH}.dmg"
if [[ ! -f "$DMG_PATH" ]]; then
  echo "distribute: DMG not found at ${DMG_PATH}" >&2
  exit 1
fi

DMG_NAME="$(basename "$DMG_PATH")"
DEST="${REPO_ROOT}/${DMG_NAME}"

cp "$DMG_PATH" "$DEST"
echo ""
echo "=== Distribution Complete ==="
echo "DMG: ${DEST}"
echo "Size: $(du -h "$DEST" | cut -f1)"
echo ""

echo "Gatekeeper status of app inside:"
spctl -a -vvv "release/mac-${ARCH}/${PRODUCT_NAME}.app" 2>&1 || true
echo ""

echo "Gatekeeper status of DMG:"
spctl -a -vvv -t install "$DEST" 2>&1 || true
echo ""

echo "To commit: git add '${DMG_NAME}' && git commit -m 'chore: update notarized DMG'"
