#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROFILE="${ENSIGN_NOTARYTOOL_PROFILE:-ensign-notary}"
PRODUCT_NAME="Ensign"
VERSION="$(node -p "require('./package.json').version")"

if [[ -d "release/mac-arm64/${PRODUCT_NAME}.app" ]]; then
  ARCH="arm64"
elif [[ -d "release/mac-x64/${PRODUCT_NAME}.app" ]]; then
  ARCH="x64"
else
  echo "notarize: unable to find ${PRODUCT_NAME}.app under release/mac-*/" >&2
  exit 1
fi

DMG_PATH="release/${PRODUCT_NAME}-${VERSION}-${ARCH}.dmg"
ZIP_PATH="release/${PRODUCT_NAME}-${VERSION}-${ARCH}.zip"

ARCHIVE_PATH=""
ARCHIVE_KIND=""
if [[ -f "$DMG_PATH" ]]; then
  ARCHIVE_PATH="$DMG_PATH"
  ARCHIVE_KIND="dmg"
elif [[ -f "$ZIP_PATH" ]]; then
  ARCHIVE_PATH="$ZIP_PATH"
  ARCHIVE_KIND="zip"
else
  echo "notarize: unable to find archive at ${DMG_PATH} or ${ZIP_PATH}" >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "notarize: xcrun not found; install Xcode Command Line Tools via: xcode-select --install" >&2
  exit 1
fi

set +e
SUBMIT_OUTPUT="$(
  xcrun notarytool submit "$ARCHIVE_PATH" \
    --keychain-profile "$PROFILE" \
    --wait \
    --output-format json \
    --no-progress 2>&1
)"
SUBMIT_EXIT=$?
set -e

if [[ $SUBMIT_EXIT -ne 0 ]]; then
  if echo "$SUBMIT_OUTPUT" | grep -q "No Keychain password item found for profile"; then
    echo "notarize: skipped (Keychain profile '${PROFILE}' not found)" >&2
    echo "notarize: one-time setup:" >&2
    echo "  xcrun notarytool store-credentials \"${PROFILE}\" --apple-id \"<APPLE_ID>\" --team-id \"<TEAM_ID>\" --sync" >&2
    exit 0
  fi
  echo "$SUBMIT_OUTPUT" >&2
  exit "$SUBMIT_EXIT"
fi

echo "$SUBMIT_OUTPUT"

if [[ "$ARCHIVE_KIND" == "dmg" ]]; then
  xcrun stapler staple -v "$ARCHIVE_PATH"
  xcrun stapler validate -v "$ARCHIVE_PATH"
fi
