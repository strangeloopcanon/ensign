#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PRODUCT_NAME="Ensign"
VERSION="$(node -p "require('./package.json').version")"

if [[ -d "release/mac-arm64/${PRODUCT_NAME}.app" ]]; then
  ARCH="arm64"
elif [[ -d "release/mac-x64/${PRODUCT_NAME}.app" ]]; then
  ARCH="x64"
else
  echo "make-dmg: unable to find ${PRODUCT_NAME}.app under release/mac-*/" >&2
  exit 1
fi

APP_PATH="release/mac-${ARCH}/${PRODUCT_NAME}.app"
OUT_DMG="release/${PRODUCT_NAME}-${VERSION}-${ARCH}.dmg"
OUT_ZIP="release/${PRODUCT_NAME}-${VERSION}-${ARCH}.zip"

TMP_DIR="$(mktemp -d)"
TMP_RW="${TMP_DIR}/${PRODUCT_NAME}-${VERSION}-${ARCH}-rw.dmg"
STAGING_DIR="${TMP_DIR}/stage"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

rm -f "$OUT_DMG"
rm -f "$OUT_ZIP"
mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "${STAGING_DIR}/${PRODUCT_NAME}.app"

# NOTE: We intentionally do NOT include an /Applications symlink here because
# `hdiutil create -srcfolder` attempts to follow it in some sandboxed runners,
# causing hard-to-diagnose failures. Keeping the DMG simple makes it robust.

# DMG builder deps default to APFS; HFS+ is more broadly compatible.
if ! hdiutil create \
  -srcfolder "$STAGING_DIR" \
  -volname "${PRODUCT_NAME} ${VERSION}-${ARCH}" \
  -anyowners \
  -nospotlight \
  -format UDRW \
  -fs HFS+ \
  "$TMP_RW"; then
  echo "make-dmg: failed to create DMG (likely due to sandbox restrictions); creating a .zip instead" >&2
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$OUT_ZIP"
  echo "Created: $OUT_ZIP"
  exit 0
fi

if ! hdiutil convert "$TMP_RW" -format UDZO -imagekey zlib-level=9 -o "$OUT_DMG"; then
  echo "make-dmg: failed to convert DMG; creating a .zip instead" >&2
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$OUT_ZIP"
  echo "Created: $OUT_ZIP"
  exit 0
fi

echo "Created: $OUT_DMG"
