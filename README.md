# Ensign

Ensign is a command‑first desktop app for running a Codex agent against a folder (and optionally dropped files), with a dry‑run plan + explicit permission gating before it runs.

## Install (macOS)
- Use the signed `.dmg` (it contains the `.app`). Open the DMG → drag the app into **Applications** → launch.
- On first launch, Ensign shows a welcome screen if no API key is configured. Click **Add API key** and paste your OpenAI key; it’s stored locally on that device.

## Distribution Paths
- **Just install:** share the signed `.dmg`. While the repo is private, that usually means sending the DMG directly. Once the repo is public, tagged builds can also be attached to GitHub Releases.
- **Clone and build:** clone the repo, run `make setup`, then `make all`. Build a macOS app bundle with `cd ensign-desktop && npm run build:mac` or a signed/notarized DMG with `cd ensign-desktop && npm run build:mac:signed`.

Developer docs live at `ensign-desktop/README.md`.
