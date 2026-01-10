import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type AppSettings = {
  workspaceDir: string | null;
  outputDir: string | null;
  modelOverride: string | null;
  codexHomeMode: 'app' | 'global';
  sandboxMode: SandboxMode;
  includeFileContents: boolean;
};

function defaultWorkspaceDir(): string | null {
  try {
    const p = app.getPath('downloads');
    return typeof p === 'string' && p.length ? p : null;
  } catch {
    return null;
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  workspaceDir: null,
  outputDir: null,
  modelOverride: 'gpt-5.2',
  codexHomeMode: 'app',
  sandboxMode: 'read-only',
  includeFileContents: true,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function readSettings(): AppSettings {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS, workspaceDir: defaultWorkspaceDir() };
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      ...DEFAULT_SETTINGS,
      ...(parsed as Partial<AppSettings>),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(next: AppSettings): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...next };
  const p = settingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  return writeSettings({ ...readSettings(), ...patch });
}
