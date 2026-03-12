#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROFILE="${ENSIGN_NOTARYTOOL_PROFILE:-ensign-notary}"
REQUIRE_NOTARIZATION="${ENSIGN_NOTARIZATION_REQUIRED:-0}"
PRODUCT_NAME="Ensign"
VERSION="$(node -p "require('./package.json').version")"
DMG_NOTARIZE_TIMEOUT="${ENSIGN_DMG_NOTARIZE_TIMEOUT:-600}"

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
APP_PATH="release/mac-${ARCH}/${PRODUCT_NAME}.app"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "notarize: xcrun not found; install Xcode Command Line Tools via: xcode-select --install" >&2
  exit 1
fi

notary_auth_args=()
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  notary_auth_args=(
    --apple-id "$APPLE_ID"
    --password "$APPLE_APP_SPECIFIC_PASSWORD"
    --team-id "$APPLE_TEAM_ID"
  )
else
  notary_auth_args=(--keychain-profile "$PROFILE")
fi

# --- Step 0: verify credentials before doing any work ---
set +e
AUTH_OUT="$(xcrun notarytool history "${notary_auth_args[@]}" 2>&1)"
AUTH_RC=$?
set -e

if [[ $AUTH_RC -ne 0 ]]; then
  if echo "$AUTH_OUT" | grep -Eiq "keychain.*profile.*(not found|missing)|no keychain.*profile|no keychain password item found for profile"; then
    if [[ "$REQUIRE_NOTARIZATION" == "1" ]]; then
      echo "notarize: required, but Keychain profile '${PROFILE}' was not found and no APPLE_* credentials were provided" >&2
      echo "notarize: provide APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID or create the profile with:" >&2
      echo "  xcrun notarytool store-credentials \"${PROFILE}\" --apple-id \"<APPLE_ID>\" --team-id \"<TEAM_ID>\" --password \"<APP_SPECIFIC_PASSWORD>\"" >&2
      exit 1
    fi
    echo "notarize: skipped (Keychain profile '${PROFILE}' not found)" >&2
    echo "notarize: one-time setup:" >&2
    echo "  xcrun notarytool store-credentials \"${PROFILE}\" --apple-id \"<APPLE_ID>\" --team-id \"<TEAM_ID>\" --password \"<APP_SPECIFIC_PASSWORD>\"" >&2
    exit 0
  fi
  echo "$AUTH_OUT" >&2
  exit "$AUTH_RC"
fi

# Submit an archive for notarization.  Tries the default (S3-accelerated)
# upload first; if that crashes (SIGBUS on some CLT versions with large
# files) it falls back to --no-s3-acceleration.  If the upload itself fails
# but Apple received the submission ID, we use "notarytool wait" to poll.
submit_archive() {
  local archive="$1"
  local tmplog
  tmplog="$(mktemp)"

  # Attempt 1: default upload
  set +e
  xcrun notarytool submit "$archive" \
    "${notary_auth_args[@]}" \
    --wait --no-progress >"$tmplog" 2>&1
  local rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    cat "$tmplog"
    rm -f "$tmplog"
    return 0
  fi

  # SIGBUS (138) or other crash → retry without S3 acceleration
  if [[ $rc -eq 138 || $rc -gt 128 ]]; then
    echo "notarize: upload crashed (exit $rc); retrying without S3 acceleration..." >&2
    set +e
    xcrun notarytool submit "$archive" \
      "${notary_auth_args[@]}" \
      --no-s3-acceleration \
      --wait --no-progress >"$tmplog" 2>&1
    rc=$?
    set -e
  fi

  if [[ $rc -eq 0 ]]; then
    cat "$tmplog"
    rm -f "$tmplog"
    return 0
  fi

  # Upload may have failed but submission was created.  Try to extract the
  # submission ID from the output or error log and poll with "wait".
  local sub_id=""
  sub_id="$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$tmplog" | head -1 || true)"

  if [[ -n "$sub_id" ]]; then
    echo "notarize: upload reported error (exit $rc) but submission $sub_id was created; polling..." >&2
    set +e
    xcrun notarytool wait "$sub_id" "${notary_auth_args[@]}" >"$tmplog" 2>&1
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      cat "$tmplog"
      rm -f "$tmplog"
      return 0
    fi
  fi

  cat "$tmplog" >&2
  rm -f "$tmplog"
  return "$rc"
}

# --- Step 1: notarize the app via ZIP (proven reliable path) ---
echo "notarize: step 1 — notarize app via ZIP"
NOTARIZE_ZIP="${ZIP_PATH}"
CREATED_TMP_ZIP=0
if [[ ! -f "$NOTARIZE_ZIP" ]]; then
  NOTARIZE_ZIP="release/${PRODUCT_NAME}-${VERSION}-${ARCH}-notarize.zip"
  echo "notarize: creating ZIP for notarization: ${NOTARIZE_ZIP}"
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$NOTARIZE_ZIP"
  CREATED_TMP_ZIP=1
fi

set +e
ZIP_OUTPUT="$(submit_archive "$NOTARIZE_ZIP")"
ZIP_RC=$?
set -e

if [[ $CREATED_TMP_ZIP -eq 1 ]]; then
  rm -f "$NOTARIZE_ZIP"
fi

if [[ $ZIP_RC -ne 0 ]]; then
  echo "notarize: ZIP submission failed (exit $ZIP_RC)" >&2
  exit "$ZIP_RC"
fi
echo "$ZIP_OUTPUT"

# --- Step 2: staple the app ---
echo ""
echo "notarize: step 2 — staple app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
echo ""
spctl -a -vvv "$APP_PATH" 2>&1
echo ""

# --- Step 3: notarize the DMG (best-effort) ---
if [[ -f "$DMG_PATH" ]]; then
  echo "notarize: step 3 — notarize DMG"

  set +e
  DMG_OUTPUT="$(submit_archive "$DMG_PATH")"
  DMG_RC=$?
  set -e

  if [[ $DMG_RC -eq 0 ]]; then
    echo "$DMG_OUTPUT"
    echo ""
    xcrun stapler staple "$DMG_PATH"
    xcrun stapler validate "$DMG_PATH"
    echo ""
    spctl -a -vvv -t install "$DMG_PATH" 2>&1
  else
    echo "notarize: DMG notarization failed (exit $DMG_RC); the app inside is already notarized and stapled" >&2
  fi
else
  echo "notarize: no DMG found at ${DMG_PATH}; skipping DMG notarization" >&2
fi

echo ""
echo "notarize: done"
