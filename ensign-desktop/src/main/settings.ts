import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type AppSettings = {
  workspaceDir: string | null;
  additionalWritableRoots: string[];
  outputDir: string | null;
  modelOverride: string | null;
  codexHomeMode: 'app' | 'global';
  sandboxMode: SandboxMode;
  includeFileContents: boolean;
  allowOutsideWorkspaceRead: boolean;
  taskConcurrency: number;
  experimentalSearch: boolean;
  experimentalPlanTool: boolean;
  experimentalConfigOverrides: string[];
  selectedSkills: string[];
};

function defaultWorkspaceDir(): string | null {
  try {
    const p = app.getPath('downloads');
    return typeof p === 'string' && p.length ? p : null;
  } catch {
    return null;
  }
}

function normalizeDirectoryList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    try {
      const st = fs.statSync(resolved);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    unique.add(resolved);
  }
  return Array.from(unique);
}

const DEFAULT_SETTINGS: AppSettings = {
  workspaceDir: null,
  additionalWritableRoots: [],
  outputDir: null,
  modelOverride: 'gpt-5.2',
  codexHomeMode: 'app',
  sandboxMode: 'read-only',
  includeFileContents: true,
  allowOutsideWorkspaceRead: false,
  taskConcurrency: 1,
  experimentalSearch: false,
  experimentalPlanTool: false,
  experimentalConfigOverrides: [],
  selectedSkills: [],
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
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...(parsed as Partial<AppSettings>),
    };
    merged.allowOutsideWorkspaceRead = !!merged.allowOutsideWorkspaceRead;
    merged.additionalWritableRoots = normalizeDirectoryList((merged as any).additionalWritableRoots);
    if (!Number.isFinite(merged.taskConcurrency) || merged.taskConcurrency < 1) merged.taskConcurrency = DEFAULT_SETTINGS.taskConcurrency;
    merged.taskConcurrency = Math.max(1, Math.min(8, Math.floor(merged.taskConcurrency)));
    if (!Array.isArray(merged.experimentalConfigOverrides)) merged.experimentalConfigOverrides = DEFAULT_SETTINGS.experimentalConfigOverrides;
    merged.experimentalConfigOverrides = merged.experimentalConfigOverrides.filter((v) => typeof v === 'string');
    if (!Array.isArray(merged.selectedSkills)) merged.selectedSkills = DEFAULT_SETTINGS.selectedSkills;
    merged.selectedSkills = merged.selectedSkills.filter((v) => typeof v === 'string');
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(next: AppSettings): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...next };
  merged.additionalWritableRoots = normalizeDirectoryList((merged as any).additionalWritableRoots);
  const p = settingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  return writeSettings({ ...readSettings(), ...patch });
}
