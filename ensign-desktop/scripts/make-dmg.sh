#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PRODUCT_NAME="Ensign"
VERSION="$(node -p "require('./package.json').version")"
REQUIRE_SIGNED_DMG="${ENSIGN_REQUIRE_SIGNED_DMG:-0}"

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
STAGING_DIR="${TMP_DIR}/stage"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

extract_signing_identity() {
  if ! command -v codesign >/dev/null 2>&1; then
    return 1
  fi

  local authority
  authority="$(
    codesign -dv --verbose=4 "$APP_PATH" 2>&1 \
      | sed -n 's/^Authority=\(Developer ID Application: .*\)$/\1/p' \
      | head -n 1
  )"

  if [[ -z "$authority" ]]; then
    return 1
  fi

  printf '%s\n' "$authority"
}

rm -f "$OUT_DMG"
rm -f "$OUT_ZIP"
mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "${STAGING_DIR}/${PRODUCT_NAME}.app"

# No /Applications symlink: hdiutil follows it in some sandboxed runners.

if ! hdiutil create \
  -srcfolder "$STAGING_DIR" \
  -volname "${PRODUCT_NAME}" \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$OUT_DMG"; then
  echo "make-dmg: hdiutil failed; creating a .zip instead" >&2
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$OUT_ZIP"
  echo "Created: $OUT_ZIP"
  exit 0
fi

SIGNING_IDENTITY="$(extract_signing_identity || true)"
if [[ -n "$SIGNING_IDENTITY" ]]; then
  echo "Signing DMG with: $SIGNING_IDENTITY"
  codesign --force --sign "$SIGNING_IDENTITY" --timestamp "$OUT_DMG"
  codesign --verify --verbose=2 "$OUT_DMG"
elif [[ "$REQUIRE_SIGNED_DMG" == "1" ]]; then
  echo "make-dmg: no Developer ID Application signature found on ${APP_PATH}; refusing to emit an unsigned DMG" >&2
  exit 1
else
  echo "make-dmg: no Developer ID Application signature found on ${APP_PATH}; leaving DMG unsigned" >&2
fi

echo "Created: $OUT_DMG"
