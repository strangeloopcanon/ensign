# Ensign

Command-first Electron app that wraps the Codex CLI/SDK with a single-screen "Command + Canvas" experience. Type a task (and optionally drop files), review the dry-run plan, grant permissions, then run to generate the artifact. Deterministic outputs are versioned to an `AI Output` folder and saves are undoable.

## Install & Use (Packaged App)
If you have a packaged build, distribute the `.dmg` (it contains the `.app`).

1. Open the `.dmg` → drag the app into **Applications**.
2. Launch the app from **Applications**.
3. If no key is configured, the home screen shows **Add API key**. Paste your key in **Settings → Connection** (each user enters their own key).
4. (Optional) Choose a folder to work in (defaults to **Downloads**).
5. Type a task → **Generate plan** → review the **Execution plan** → check required permissions → **Run**.
6. Use **Save As** to write outputs into `~/Documents/AI Output/` (or your Settings override).

## Developer Quick Start
1. **Install deps**
   ```bash
   cd ensign-desktop
   npm install
   ```
2. **Configure API key**
   - On first launch, Ensign prompts for a key. Paste it into **Settings → Connection** (stored in the app’s `.env`).
   - Or set `OPENAI_API_KEY` (or `CODEX_API_KEY`) in a local `.env`:
     - `ensign-desktop/.env` (preferred when running from `ensign-desktop/`)
     - repo root `.env` (also supported in dev)
3. **(Optional) Configure Codex config + MCP connectors**
   - By default the app keeps its own Codex config under its app data directory (no manual copying).
   - You can switch to your existing `~/.codex` config or import it from Settings.
   - Use the Codex CLI to manage connectors:
     ```bash
     codex login
     codex mcp add gmail
     codex mcp add google-calendar
     ```
4. **Run in dev**
   ```bash
   npm run start
   ```
   - Vite serves the renderer on `http://localhost:5173`.
   - `tsc` watches the main process.
   - Electron launches once Vite is ready.

## Building Packages
- **macOS (DMG)**
  ```bash
  npm run build
  ```
- **Windows (NSIS + MSI)**
  ```bash
  npm run build:win
  ```
  (Run on Windows or in the `electronuserland/builder:wine` image.)
- **Linux (AppImage + deb)**
  ```bash
  npm run build:linux
  ```
  Requires `fpm`/dpkg tooling; easiest in the builder image or a native Linux environment.

Artifacts land in `release/` and the runnable unpacked apps live under `release/<platform>-unpacked/`.

## Command + Canvas UX
- **Command bar** accepts text and drag-and-drop files.
- **Toolbar** shows folder/model/LLM readiness and provides quick access to folder selection + Settings.
- **Execution plan** modal shows the dry-run plan, detected permissions (files, network, MCP connectors), and sources. Required items must be checked before **Run** enables.
- **Canvas** renders the working artifact for the selected task; when a source file is provided the diff view highlights changes line-by-line.
- **Tasks drawer** shows queued/running/completed tasks, a structured Activity log (commands/files/MCP/search/todos), and the plan for the selected task.
- **Action bar** provides Save As / Undo / Redo. Saves are versioned under `~/Documents/AI Output/`.

## OS Hooks
- Global hotkey `Cmd/Ctrl+Shift+K` seeds the command bar with the current clipboard.
- Drag files onto the dock icon or window (or use Finder “Open With”) to populate sources and enable diff previews.
- The packaged build handles `open-file` and second-instance launches so right-click “Open With Ensign” works.

## MCP Connectors & Permissions
- Ensign does **not** ship its own connectors. It reuses whatever the Codex CLI exposes in `~/.codex/config.toml`.
- When you run `codex mcp add <connector>`, the connector name appears in the Execution plan.
- Heuristics mark mail/calendar connectors as *required* when the prompt clearly asks for those actions (`email`, `meeting`, `schedule`, etc.). You must explicitly grant them before running.
- Optional connectors stay unchecked; toggle them to document consent when you know the task needs them.

## Configuration Reference
- `OPENAI_API_KEY` (or `CODEX_API_KEY`) can be set via the in-app Settings UI or a local `.env`. Packaged builds store it under Electron’s `userData` directory (the Settings UI shows the exact path; typically `~/Library/Application Support/<App Name>/.env` on macOS).
- Default model is `gpt-5.2` (override via Settings).
- **Model override** and **sandbox mode** are app settings; clear model to use the active Codex config (or Codex defaults).
- The app surfaces the effective config path and whether it exists. Use **Settings → Codex config → Open** to edit it.

## Stub mode
Set `ENSIGN_DESKTOP_FORCE_STUB=1` to run in deterministic stub mode (no network/model calls). This is mainly for UI testing and demos.

## Skills (prompt packs)
Ensign supports lightweight “skills” that act as instruction packs injected into the task prompt.

- **Where:** put skills under your workspace folder at `.ensign/skills/<skill-id>/SKILL.md`.
- **Format:** optional YAML frontmatter, then Markdown instructions:
  - `name:` (optional)
  - `description:` (optional)
- **Enable:** Settings → Advanced → Skills (select one or more).

## Testing
Playwright exercises the core flows end-to-end.
```bash
npm test
```
The suite runs serially (single-instance Electron) and covers:
- App boot in production mode.
- Plan review + Run flow.
- Diff preview with a test file.
- Deterministic save, undo, and redo.

## Undo / Versioning
Every saved artifact is recorded in a transaction log under Electron’s `userData` directory (typically `~/Library/Application Support/<App Name>/transactions/` on macOS). Undo temporarily moves files into a private trash folder; Redo restores them. Versioned filenames (`<name> (1).txt`, etc.) prevent accidental overwrites.

## Limitations & Next Steps
- Permission heuristics are intentionally conservative. If a task implicitly needs another connector, toggle it manually before running.
- Non-text diffs (PDF, DOCX) are presented as generated text today. Planned work includes richer previews per MIME type.
- Automation shortcuts and Quick Actions are stubbed at the OS level; wiring them through macOS Shortcuts and Windows Context actions is tracked separately.

## Support
For CLI configuration, refer to the Codex documentation. The desktop app logs developer errors to the shell; use `npm run start` with `ELECTRON_ENABLE_LOGGING=1` for additional diagnostics.

## macOS Code Signing & Notarization

Electron apps distributed outside the App Store should be signed and notarized so they open without the “unidentified developer” warning.

Prereq: install Xcode Command Line Tools (you do not need full Xcode):
```bash
xcode-select --install
```

1) Developer ID certificate
- Install a "Developer ID Application" certificate in your login keychain (Keychain Access › Certificates), or provide a `.p12` via env:
  - `CSC_LINK` – HTTPS URL or Base64 data URI to the `.p12`
  - `CSC_KEY_PASSWORD` – certificate password

2) Notarization credentials
- Recommended: use `notarytool` and a Keychain profile (local builds), or use env vars (CI).

**Option A: env vars (CI-friendly)**
- Export as GitHub Secrets or local env vars:
  - `APPLE_ID` – your Apple ID email
  - `APPLE_APP_SPECIFIC_PASSWORD` – the 16‑char app‑specific password
  - `APPLE_TEAM_ID` – your Team ID (e.g., ABCDE12345)

3) Build
```bash
cd ensign-desktop
# auto‑discover signing identity from Keychain, notarize with env
npm run build:mac:signed
```

**Option B: Keychain profile (recommended locally)**
```bash
# one-time: store notarization creds in Keychain
xcrun notarytool store-credentials ensign-notary \
  --apple-id "you@example.com" \
  --team-id "ABCDE12345" \
  --sync

# build signed DMG + notarize + staple (uses ensign-notary if present)
npm run build:mac:signed
```

Notes
- The builder is configured with hardened runtime and entitlements at `assets/entitlements.mac.plist`.
- Notarization is enabled (`notarize: true`) and uses the env vars above; local builds can also notarize via the Keychain profile (`ensign-notary`) without exposing secrets in env.
- For CI, a ready‑to‑use workflow lives at `.github/workflows/mac-release.yml`.
