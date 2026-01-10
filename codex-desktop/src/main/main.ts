import { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as url from 'node:url';
import os from 'node:os';
import { runTask } from './codex';
import { readStatus, getConfigPath } from './config';
import dotenv from 'dotenv';
import { recordCreate, undo as txUndo, redo as txRedo, history as txHistory } from './transactions';
import { readSettings, updateSettings, type AppSettings, type SandboxMode } from './settings';

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
let cachedEnvPath: string | null = null;
const originalCodexHome = process.env.CODEX_HOME;

const userDataOverride = process.env.CODEX_DESKTOP_USER_DATA;
if (userDataOverride) {
  try {
    app.setPath('userData', path.resolve(userDataOverride));
  } catch (e) {
    console.warn('Failed to set userData override', e);
  }
}

function findUpwards(startDir: string, predicate: (dir: string) => boolean): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (predicate(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveProjectRoot(): string {
  if (!isDev) return app.getAppPath();
  // Prefer the git root if available so dev env/config can live at repo root.
  return findUpwards(process.cwd(), (dir) => fs.existsSync(path.join(dir, '.git'))) ?? process.cwd();
}

function resolveEnvPath(): string {
  if (cachedEnvPath) return cachedEnvPath;
  if (isDev) {
    const direct = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(direct)) cachedEnvPath = direct;
    else cachedEnvPath = path.resolve(resolveProjectRoot(), '.env');
  } else {
    cachedEnvPath = path.join(app.getPath('userData'), '.env');
  }
  return cachedEnvPath;
}

function loadEnv() {
  const envPath = resolveEnvPath();
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

function getApiKeyPresent(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);
}

function getAppCodexHomeDir(): string {
  return path.join(app.getPath('userData'), 'codex');
}

function getGlobalCodexConfigPath(): string {
  const dir = originalCodexHome || path.join(os.homedir(), '.codex');
  return path.join(dir, 'config.toml');
}

function ensureCodexConfigAt(configPath: string, model: string) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(configPath)) return;
  const content = `model = "${model}"\npreferred_auth_method = "env"\n\n[mcp_servers]\n`;
  fs.writeFileSync(configPath, content, 'utf8');
}

function applyCodexHomeFromSettings(settings: AppSettings) {
  if (settings.codexHomeMode === 'app') {
    const home = getAppCodexHomeDir();
    process.env.CODEX_HOME = home;
    const model = settings.modelOverride || 'gpt-5.2';
    ensureCodexConfigAt(path.join(home, 'config.toml'), model);
  } else {
    if (originalCodexHome) process.env.CODEX_HOME = originalCodexHome;
    else delete process.env.CODEX_HOME;
  }
}

function getOutputDir(): string {
  const settings = readSettings();
  if (settings.outputDir) return settings.outputDir;
  return path.join(app.getPath('documents'), 'AI Output');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = url.pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString();
    win.loadURL(indexPath);
  }

  return win;
}

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _cwd) => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      const files = argv.filter((a) => a && !a.startsWith('-') && fs.existsSync(a));
      if (files.length) win.webContents.send('codex:incomingFiles', files);
    }
  });
  let pendingOpenFiles: string[] = [];

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) {
      const [win] = BrowserWindow.getAllWindows();
      if (win) win.webContents.send('codex:incomingFiles', [filePath]);
    } else {
      pendingOpenFiles.push(filePath);
    }
  });

  app.whenReady().then(() => {
    loadEnv();
    applyCodexHomeFromSettings(readSettings());
    const win = createWindow();

    // Deliver any pending file-open events
    if (pendingOpenFiles.length) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('codex:incomingFiles', pendingOpenFiles);
        pendingOpenFiles = [];
      });
    }

    // Global hotkey: CommandOrControl+Shift+K
    try {
      globalShortcut.register('CommandOrControl+Shift+K', () => {
        const text = clipboard.readText();
        const [w] = BrowserWindow.getAllWindows();
        if (w) w.webContents.send('codex:hotkey', { text });
      });
    } catch (e) {
      console.warn('Failed to register hotkey', e);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC
ipcMain.handle('codex:run', async (event, { prompt, cwd, sandboxMode, modelOverride }) => {
  if (cwd) {
    try {
      const resolved = path.resolve(cwd);
      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        return { ok: false, error: `cwd is not a directory: ${resolved}` };
      }
      cwd = resolved;
    } catch (err: any) {
      return { ok: false, error: `Invalid working directory: ${err?.message || cwd}` };
    }
  }
  const { sender } = event;
  let aggregate = '';
  const append = (chunk: string) => {
    aggregate += chunk;
    try {
      sender.send('codex:stream', chunk);
    } catch (error) {
      console.error('Failed to relay stream chunk', error);
    }
  };
  try {
    const saved = readSettings();
    const effectiveSandboxMode = isSandboxMode(sandboxMode) ? sandboxMode : saved.sandboxMode;
    const effectiveModelOverride =
      typeof modelOverride === 'string' ? modelOverride : typeof saved.modelOverride === 'string' ? saved.modelOverride : null;
    const result = await runTask(
      { prompt, cwd, sandboxMode: effectiveSandboxMode, modelOverride: effectiveModelOverride },
      append
    );
    return { ok: true, text: result };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('codex:readStatus', async () => {
  try {
    return { ok: true, status: readStatus() };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('codex:openConfig', async () => {
  const p = getConfigPath();
  const res = await shell.openPath(p);
  return { ok: !res, path: p, error: res || null };
});

ipcMain.handle('codex:openMcpDocs', async () => {
  await shell.openExternal('https://developers.openai.com/codex/mcp/');
  return { ok: true };
});

ipcMain.handle('codex:saveApiKey', async (_e, key: string) => {
  try {
    const envPath = resolveEnvPath();
    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let content = '';
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const others = lines.filter((l) => !l.startsWith('OPENAI_API_KEY='));
    others.push(`OPENAI_API_KEY=${key}`);
    fs.writeFileSync(envPath, others.join('\n') + '\n', 'utf8');
    process.env.OPENAI_API_KEY = key;
    applyCodexHomeFromSettings(readSettings());
    return { ok: true, path: envPath };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:verifyApiKey', async (_e, key?: string) => {
  try {
    const stubMode = process.env.CODEX_DESKTOP_FORCE_STUB === '1';
    if (stubMode) return { ok: true, stubMode: true };

    const candidate = typeof key === 'string' && key.trim() ? key.trim() : null;
    const effectiveKey = candidate || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || null;
    if (!effectiveKey) return { ok: false, error: 'No API key configured' };

    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const modelsUrl = new URL('/v1/models', base).toString();
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
      },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, error: 'Invalid API key (401)' };
    return { ok: false, error: `Verification failed (${res.status})` };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:pickCwd', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('codex:getEnvInfo', async () => {
  const openAiKey = process.env.OPENAI_API_KEY;
  const codexKey = process.env.CODEX_API_KEY;
  const apiKeyPresent = !!(openAiKey || codexKey);
  const apiKeyName = openAiKey ? 'OPENAI_API_KEY' : codexKey ? 'CODEX_API_KEY' : null;
  const stubMode = process.env.CODEX_DESKTOP_FORCE_STUB === '1';
  return { ok: true, envPath: resolveEnvPath(), apiKeyPresent, apiKeyName, stubMode };
});

ipcMain.handle('codex:getSettings', async () => {
  return { ok: true, settings: readSettings() };
});

function isSandboxMode(v: unknown): v is SandboxMode {
  return v === 'read-only' || v === 'workspace-write' || v === 'danger-full-access';
}

ipcMain.handle('codex:updateSettings', async (_e, patch: Partial<AppSettings>) => {
  try {
    const next: Partial<AppSettings> = {};
    if (typeof patch?.workspaceDir === 'string' || patch?.workspaceDir === null) next.workspaceDir = patch.workspaceDir;
    if (typeof patch?.outputDir === 'string' || patch?.outputDir === null) next.outputDir = patch.outputDir;
    if (typeof patch?.modelOverride === 'string' || patch?.modelOverride === null) next.modelOverride = patch.modelOverride;
    if (patch?.codexHomeMode === 'app' || patch?.codexHomeMode === 'global') next.codexHomeMode = patch.codexHomeMode;
    if (typeof patch?.includeFileContents === 'boolean') next.includeFileContents = patch.includeFileContents;
    if (isSandboxMode((patch as any)?.sandboxMode)) next.sandboxMode = (patch as any).sandboxMode;
    const updated = updateSettings(next);
    applyCodexHomeFromSettings(updated);
    return { ok: true, settings: updated };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:initCodexConfig', async () => {
  try {
    const settings = readSettings();
    applyCodexHomeFromSettings(settings);
    const p = getConfigPath();
    if (!fs.existsSync(p)) {
      const model = settings.modelOverride || 'gpt-5.2';
      ensureCodexConfigAt(p, model);
    }
    return { ok: true, path: p };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:importGlobalCodexConfig', async () => {
  try {
    const settings = readSettings();
    if (settings.codexHomeMode !== 'app') return { ok: false, error: 'Switch to app-managed Codex config first.' };
    const src = getGlobalCodexConfigPath();
    if (!fs.existsSync(src)) return { ok: false, error: `Global config not found: ${src}` };
    applyCodexHomeFromSettings(settings);
    const dest = getConfigPath();
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dest);
    return { ok: true, path: dest };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Plan preview: compute a simple dry-run plan and permissions
ipcMain.handle(
  'codex:plan',
  async (
    _e,
    payload: { prompt: string; files?: { name: string }[]; cwd?: string; sandboxMode?: SandboxMode; modelOverride?: string | null }
  ) => {
  const files = payload?.files || [];
  const stubMode = process.env.CODEX_DESKTOP_FORCE_STUB === '1';
  const apiKeyPresent = getApiKeyPresent();
  let cwd = payload?.cwd;
  if (cwd) {
    try {
      const resolved = path.resolve(cwd);
      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) cwd = undefined;
      else cwd = resolved;
    } catch {
      cwd = undefined;
    }
  }
  const sandboxMode = isSandboxMode(payload?.sandboxMode) ? payload.sandboxMode : readSettings().sandboxMode;
  const modelOverride = typeof payload?.modelOverride === 'string' ? payload.modelOverride.trim() : null;
  const steps = [
    { id: 'parse', text: 'Parse inputs and understand intent' },
    cwd ? { id: 'cwd', text: `Work in folder: ${cwd}` } : null,
    files.length > 0 ? { id: 'read', text: `Read ${files.length} file(s)` } : { id: 'noop', text: 'No external files' },
    !stubMode && !apiKeyPresent ? { id: 'key', text: 'Configure API key in Settings' } : null,
    { id: 'gen', text: 'Generate artifact' },
    sandboxMode !== 'read-only' ? { id: 'writes', text: `Potentially write files (${sandboxMode})` } : null,
    modelOverride ? { id: 'model', text: `Use model override: ${modelOverride}` } : null,
  ].filter(Boolean) as { id: string; text: string }[];
  const promptText = (payload?.prompt || '').toLowerCase();
  const needsEmail = /\b(email|mail|inbox|reply|gmail)\b/.test(promptText);
  const needsCalendar = /\b(calendar|schedule|event|meeting)\b/.test(promptText);
  const status = readStatus();
  const mcpPermissions = (status.mcpNames || []).map((name) => {
    const key = name.toLowerCase();
    let required = false;
    if (needsEmail && /(mail|gmail|email)/.test(key)) required = true;
    if (needsCalendar && /(cal|calendar)/.test(key)) required = true;
    const id = `mcp-${key.replace(/[^a-z0-9]+/g, '-')}`;
    return {
      id,
      label: `Use MCP server "${name}"`,
      required,
    };
  });
  const permissions = [
    ...(files.length
      ? [{ id: 'read-files', label: `Read ${files.length} file(s)`, required: true }]
      : []),
    ...(!stubMode ? [{ id: 'network', label: 'Network access (model call)', required: true }] : []),
    ...(sandboxMode !== 'read-only' ? [{ id: 'write-workspace', label: `Write files (${sandboxMode})`, required: true }] : []),
    ...mcpPermissions,
  ];
  const sources = [...(cwd ? [cwd] : []), ...files.map((f) => f.name)];
  return { ok: true, plan: { steps, permissions, sources } };
});

// Save artifact deterministically with versioning
ipcMain.handle('codex:saveArtifact', async (_e, payload: { name: string; kind: 'text'; content: string }) => {
  try {
    const baseDir = getOutputDir();
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const safeName = payload.name.replace(/[^\w\-\s\.]+/g, '').trim().slice(0, 80) || 'artifact';
    const targetBase = path.join(baseDir, safeName + '.txt');
    let target = targetBase;
    let i = 1;
    while (fs.existsSync(target)) {
      const dot = targetBase.lastIndexOf('.');
      const stem = dot === -1 ? targetBase : targetBase.slice(0, dot);
      const ext = dot === -1 ? '' : targetBase.slice(dot);
      target = `${stem} (${i++})${ext}`;
    }
    fs.writeFileSync(target, payload.content, 'utf8');
    recordCreate(target);
    return { ok: true, path: target };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:undo', async () => txUndo());
ipcMain.handle('codex:redo', async () => txRedo());
ipcMain.handle('codex:getHistory', async () => ({ ok: true, history: txHistory() }));

ipcMain.handle('codex:openOutputFolder', async () => {
  const p = getOutputDir();
  const res = await shell.openPath(p);
  return { ok: !res, path: p, error: res || null };
});

ipcMain.handle('codex:openPath', async (_e, p: string) => {
  if (!p || typeof p !== 'string') return { ok: false, error: 'Missing path' };
  const resolved = path.resolve(p);
  const res = await shell.openPath(resolved);
  return { ok: !res, path: resolved, error: res || null };
});

// Simple text read for diff previews
ipcMain.handle('codex:readFileText', async (_e, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ok: false, error: 'Not a file' };
    // guard: avoid huge files
    const max = 5 * 1024 * 1024;
    if (stat.size > max) return { ok: false, error: 'File too large' };
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Test helper used by Playwright specs to simulate Finder drops.
ipcMain.handle('codex:debugEmitFiles', async (_event, paths: string[]) => {
  const [win] = BrowserWindow.getAllWindows();
  if (win && Array.isArray(paths) && paths.length) {
    win.webContents.send('codex:incomingFiles', paths);
  }
  return { ok: true };
});
