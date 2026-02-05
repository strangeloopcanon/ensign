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

function normalizeDirectoryList(value: unknown, validateExists: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    if (validateExists) {
      try {
        const st = fs.statSync(resolved);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
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

type CachedSettingsMeta = {
  mtimeMs: number;
  size: number;
};

let cachedSettings: AppSettings | null = null;
let cachedSettingsMeta: CachedSettingsMeta | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function buildDefaultSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, workspaceDir: defaultWorkspaceDir() };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    additionalWritableRoots: [...settings.additionalWritableRoots],
    experimentalConfigOverrides: [...settings.experimentalConfigOverrides],
    selectedSkills: [...settings.selectedSkills],
  };
}

function normalizeSettings(parsed: unknown, validateDirectories: boolean): AppSettings {
  const base = buildDefaultSettings();
  if (!parsed || typeof parsed !== 'object') {
    return base;
  }

  const merged: AppSettings = {
    ...base,
    ...(parsed as Partial<AppSettings>),
  };
  merged.allowOutsideWorkspaceRead = !!merged.allowOutsideWorkspaceRead;
  merged.additionalWritableRoots = normalizeDirectoryList((merged as Partial<AppSettings>).additionalWritableRoots, validateDirectories);
  if (!Number.isFinite(merged.taskConcurrency) || merged.taskConcurrency < 1) merged.taskConcurrency = DEFAULT_SETTINGS.taskConcurrency;
  merged.taskConcurrency = Math.max(1, Math.min(8, Math.floor(merged.taskConcurrency)));
  if (!Array.isArray(merged.experimentalConfigOverrides)) merged.experimentalConfigOverrides = DEFAULT_SETTINGS.experimentalConfigOverrides;
  merged.experimentalConfigOverrides = merged.experimentalConfigOverrides.filter((v) => typeof v === 'string');
  if (!Array.isArray(merged.selectedSkills)) merged.selectedSkills = DEFAULT_SETTINGS.selectedSkills;
  merged.selectedSkills = merged.selectedSkills.filter((v) => typeof v === 'string');
  return merged;
}

export function readSettings(): AppSettings {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      const fallback = buildDefaultSettings();
      cachedSettings = fallback;
      cachedSettingsMeta = null;
      return cloneSettings(fallback);
    }

    const st = fs.statSync(p);
    if (
      cachedSettings &&
      cachedSettingsMeta &&
      cachedSettingsMeta.mtimeMs === st.mtimeMs &&
      cachedSettingsMeta.size === st.size
    ) {
      return cloneSettings(cachedSettings);
    }

    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = normalizeSettings(parsed, true);
    cachedSettings = merged;
    cachedSettingsMeta = { mtimeMs: st.mtimeMs, size: st.size };
    return cloneSettings(merged);
  } catch {
    const fallback = buildDefaultSettings();
    cachedSettings = fallback;
    cachedSettingsMeta = null;
    return cloneSettings(fallback);
  }
}

export function writeSettings(next: AppSettings): AppSettings {
  const merged = normalizeSettings(next, true);
  const p = settingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  try {
    const st = fs.statSync(p);
    cachedSettings = merged;
    cachedSettingsMeta = { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    cachedSettings = merged;
    cachedSettingsMeta = null;
  }
  return cloneSettings(merged);
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  return writeSettings({ ...readSettings(), ...patch });
}
