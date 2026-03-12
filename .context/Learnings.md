# Learnings

Hard-won lessons from building and shipping this project. Read this before
debugging something that "used to work."

---

## macOS Code Signing & Notarization (March 2026)

### The pipeline

```
electron-builder --mac dir   (builds + signs the .app)
  → make-dmg.sh              (wraps .app into a DMG, signs DMG)
  → notarize-mac.sh          (notarizes via Apple, staples tickets)
```

Run the whole thing with `make distribute`.

### What broke and why

1. **`hdiutil` flags that Apple's scanner can't handle.**
   The old `make-dmg.sh` used a two-step flow (create UDRW → convert to UDZO)
   with `-anyowners`, `-nospotlight`, and explicit `-fs HFS+`. Apple's
   notarization scanner would accept the submission but never finish
   processing it — submissions stayed "In Progress" forever with no logs.
   **Fix:** single-step `hdiutil create -format UDZO -imagekey zlib-level=9`,
   no extra flags.

2. **`notarytool submit --no-s3-acceleration` fails on CompleteMultipartUpload.**
   When S3 Transfer Acceleration is disabled, the upload completes all parts
   successfully but the final `CompleteMultipartUpload` call consistently gets
   `Network.NWError error 54 — Connection reset by peer` (at least on
   macOS 26.3 / CLT 26.3 / notarytool 1.1.0). Not transient — reproduces
   every time.
   **Fix:** use the default S3-accelerated upload (do NOT pass
   `--no-s3-acceleration`). If that crashes with SIGBUS (exit 138), retry
   once; the crash is intermittent and usually succeeds on retry.

3. **Keychain locks itself after inactivity.**
   `notarytool` stores credentials in a Keychain profile. If the login
   keychain auto-locks (energy saver, screen lock, long idle), all
   notarization calls fail with "No Keychain password item found for
   profile." The error message is misleading — the profile exists, the
   keychain is just locked.
   **Fix:** `security unlock-keychain ~/Library/Keychains/login.keychain-db`
   before running the pipeline, or keep the machine unlocked.

### Things that look wrong but are fine

- `electron-builder` logs `skipped macOS notarization  reason='notarize'
  options were set explicitly 'false'` — this is intentional. We do
  notarization ourselves in `notarize-mac.sh` after DMG creation, not
  through electron-builder's built-in flow.

- The notarize script creates a temporary ZIP of the .app even though we
  also submit the DMG. This is the "ZIP-first" strategy: notarizing the
  ZIP staples the .app inside the DMG, then we notarize the DMG itself as
  a second pass. If the DMG submission fails, the app inside is still
  notarized and Gatekeeper will accept it.

### Verification commands

```bash
# Check if app is notarized
spctl -a -vvv release/mac-arm64/Ensign.app
# Expected: "source=Notarized Developer ID"

# Check if DMG is notarized
spctl -a -vvv -t install Ensign-1.0.0-arm64.dmg
# Expected: "source=Notarized Developer ID"

# Check staple
xcrun stapler validate release/mac-arm64/Ensign.app
xcrun stapler validate Ensign-1.0.0-arm64.dmg

# Check signing identity
codesign -dvvv release/mac-arm64/Ensign.app 2>&1 | grep Authority

# View notarization history
xcrun notarytool history --keychain-profile ensign-notary
```

### DMG in the repo

The notarized DMG lives at the repo root, tracked via Git LFS
(configured in `.gitattributes`). The `.git/info/exclude` file previously
had `Ensign-*.dmg` which silently hid the DMG from `git status` — that
rule was removed.

---

## General Debugging Notes

- When `notarytool submit` gets stuck in macOS "UE" (uninterruptible sleep)
  state, `kill -9` won't work. Only a reboot clears it. This happens with
  S3 acceleration on some runs — just retry in a new terminal.

- Apple submissions that show "In Progress" for more than ~20 minutes are
  almost certainly failed uploads where Apple received the submission ID
  but never got the complete file. They will stay "In Progress" forever.

- `notarytool` exit code 138 = SIGBUS. This is a bug in the SotoS3
  (Swift AWS SDK) library used internally, not a signing or credential
  issue.
