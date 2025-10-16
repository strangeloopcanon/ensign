# Codex Desktop

Command-first Electron app that wraps the Codex CLI/SDK with a single-screen "Command + Canvas" experience. Type or drop a task, review the dry-run plan, grant permissions, then accept to generate the artifact. Deterministic outputs are versioned to an `AI Output` folder and every destructive action is undoable.

## Quick Start
1. **Install deps**
   ```bash
   cd codex-desktop
   npm install
   ```
2. **Configure Codex CLI** (for models + MCP connectors)
   ```bash
   # Authenticate and add connectors (examples)
   codex login
   codex mcp add gmail
   codex mcp add google-calendar
   ```
   The desktop app reads the same `~/.codex/config.toml` and MCP registry that the CLI uses. Set `CODEX_HOME` if you keep config elsewhere.
3. **Run in dev**
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
- **Command bar** accepts text, drag-and-drop files, and provides inline chips (tone, length, target app, etc.).
- **Plan drawer** shows the dry-run plan, detected permissions (files, network, MCP connectors), sources, and current Codex config location. Required items must be checked before **Accept** enables.
- **Canvas** renders the working artifact; when a source file is provided the diff view highlights changes line-by-line.
- **Action bar** provides Run/Accept/Edit/Save/Undo/Redo. Saves are versioned under `~/Documents/AI Output/`.

## OS Hooks
- Global hotkey `Cmd/Ctrl+Shift+K` seeds the command bar with the current clipboard.
- Drag files onto the dock icon or window (or use Finder “Open With”) to populate sources and enable diff previews.
- The packaged build handles `open-file` and second-instance launches so right-click “Open With Codex Desktop” works.

## MCP Connectors & Permissions
- Codex Desktop does **not** ship its own connectors. It reuses whatever the Codex CLI exposes in `~/.codex/config.toml`.
- When you run `codex mcp add <connector>`, the connector name appears in the Plan drawer.
- Heuristics mark mail/calendar connectors as *required* when the prompt clearly asks for those actions (`email`, `meeting`, `schedule`, etc.). You must explicitly grant them before running.
- Optional connectors stay unchecked; toggle them to document consent when you know the task needs them.

## Configuration Reference
- `OPENAI_API_KEY` can live in `.env` at the repo root for dev. Packaged builds store it under Electron’s `userData` directory (`~/Library/Application Support/Codex Desktop/.env` on macOS).
- The app surfaces the effective config path and whether it exists. Click **Open Config** from the future settings menu or edit it directly.

## Testing
Playwright exercises the core flows end-to-end.
```bash
npm test
```
The suite runs serially (single-instance Electron) and covers:
- App boot in production mode.
- Plan gating + Accept flow.
- Diff preview with a test file.
- Deterministic save, undo, and redo.

## Undo / Versioning
Every saved artifact is recorded in a transaction log under `~/Library/Application Support/Codex Desktop/transactions/`. Undo temporarily moves files into a private trash folder; Redo restores them. Versioned filenames (`<name> (1).txt`, etc.) prevent accidental overwrites.

## Limitations & Next Steps
- Permission heuristics are intentionally conservative. If a task implicitly needs another connector, toggle it manually before accepting.
- Non-text diffs (PDF, DOCX) are presented as generated text today. Planned work includes richer previews per MIME type.
- Automation shortcuts and Quick Actions are stubbed at the OS level; wiring them through macOS Shortcuts and Windows Context actions is tracked separately.

## Support
For CLI configuration, refer to the Codex documentation. The desktop app logs developer errors to the shell; use `npm run start` with `ELECTRON_ENABLE_LOGGING=1` for additional diagnostics.
