import { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as url from 'node:url';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { runTask } from './codex';
import { readStatus, getConfigPath } from './config';
import dotenv from 'dotenv';
import { recordCreate, undo as txUndo, redo as txRedo, history as txHistory } from './transactions';
import { readSettings, updateSettings, type AppSettings, type SandboxMode } from './settings';
import { TaskManager, type EnqueueTaskPayload } from './tasks';
import { listWorkspaceSkills } from './skills';
import { resolveBundledCodexPath } from './codex_bin';

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
let cachedEnvPath: string | null = null;
const originalCodexHome = process.env.CODEX_HOME;
const tasks = new TaskManager();

function isStubMode(): boolean {
  return process.env.ENSIGN_DESKTOP_FORCE_STUB === '1';
}

const userDataOverride = process.env.ENSIGN_DESKTOP_USER_DATA;
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

type BundledCodexResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

async function runBundledCodex(args: string[]): Promise<BundledCodexResult> {
  const codexPath = resolveBundledCodexPath();
  if (!codexPath) return { ok: false, stdout: '', stderr: '', exitCode: null, error: 'Bundled Codex binary not found' };

  return new Promise((resolve) => {
    const child = spawn(codexPath, args, { env: process.env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.once('error', (err) => {
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: null,
        error: err?.message || 'Failed to spawn Codex',
      });
    });

    child.stdout?.on('data', (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr?.on('data', (d) => stderrChunks.push(Buffer.from(d)));

    child.once('exit', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) {
        resolve({ ok: true, stdout, stderr, exitCode: code });
        return;
      }
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: code,
        error: stderr.trim() || stdout.trim() || `Codex exited with code ${code}`,
      });
    });
  });
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
    const initial = readSettings();
    applyCodexHomeFromSettings(initial);
    tasks.setConcurrency(initial.taskConcurrency);
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
    let effectiveModelOverride: string | null = null;
    if (typeof modelOverride === 'string') {
      effectiveModelOverride = modelOverride;
    } else if (typeof saved.modelOverride === 'string') {
      effectiveModelOverride = saved.modelOverride;
    }
    const result = await runTask(
      { prompt, cwd, sandboxMode: effectiveSandboxMode, modelOverride: effectiveModelOverride },
      append
    );
    return { ok: true, text: result };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('codex:taskList', async () => {
  return { ok: true, tasks: tasks.listTasks() };
});

function getRequiredPermissionIds(plan: unknown): string[] {
  if (!plan || typeof plan !== 'object') return [];
  const permissions = (plan as { permissions?: unknown }).permissions;
  if (!Array.isArray(permissions)) return [];
  const required: string[] = [];
  for (const permission of permissions) {
    if (!permission || typeof permission !== 'object') continue;
    const id = (permission as { id?: unknown }).id;
    const mustApprove = (permission as { required?: unknown }).required === true;
    if (!mustApprove) continue;
    if (typeof id !== 'string' || !id.trim()) continue;
    required.push(id);
  }
  return required;
}

ipcMain.handle('codex:taskEnqueue', async (_event, payload: EnqueueTaskPayload) => {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Missing payload' };
    if (typeof payload.userPrompt !== 'string' || !payload.userPrompt.trim()) return { ok: false, error: 'Missing prompt' };
    if (typeof payload.effectivePrompt !== 'string' || !payload.effectivePrompt.trim())
      return { ok: false, error: 'Missing effective prompt' };
    const approvedPermissionIds = Array.isArray((payload as any).approvedPermissionIds)
      ? (payload as any).approvedPermissionIds.filter((id: unknown): id is string => typeof id === 'string' && !!id.trim())
      : [];
    const requiredPermissionIds = getRequiredPermissionIds((payload as any).plan);
    if (requiredPermissionIds.length > 0) {
      const approved = new Set(approvedPermissionIds);
      const missing = requiredPermissionIds.filter((id) => !approved.has(id));
      if (missing.length > 0) {
        return { ok: false, error: `Missing required permission approvals: ${missing.join(', ')}` };
      }
    }

    const saved = readSettings();
    const sandboxMode = isSandboxMode((payload as any).sandboxMode) ? (payload as any).sandboxMode : saved.sandboxMode;

    let cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : null;
    if (cwd) {
      try {
        const resolved = path.resolve(cwd);
        const stats = fs.statSync(resolved);
        if (!stats.isDirectory()) cwd = null;
        else cwd = resolved;
      } catch {
        cwd = null;
      }
    }

    let model: string | null = null;
    if (typeof (payload as any).model === 'string') {
      model = (payload as any).model as string;
    } else if (typeof saved.modelOverride === 'string') {
      model = saved.modelOverride;
    }

    const includePlanTool =
      typeof (payload as any).includePlanTool === 'boolean' ? (payload as any).includePlanTool : saved.experimentalPlanTool;
    const enableSearch =
      typeof (payload as any).enableSearch === 'boolean' ? (payload as any).enableSearch : saved.experimentalSearch;
    const baseOverrides = Array.isArray((payload as any).configOverrides)
      ? (payload as any).configOverrides.filter((v: unknown) => typeof v === 'string')
      : saved.experimentalConfigOverrides;
    const configOverrides = Array.isArray(baseOverrides) ? [...baseOverrides] : [];

    if (saved.allowOutsideWorkspaceRead && sandboxMode !== 'danger-full-access') {
      const alreadyOverridesSandboxPermissions = configOverrides.some(
        (o) => typeof o === 'string' && o.includes('sandbox_permissions')
      );
      if (!alreadyOverridesSandboxPermissions) {
        configOverrides.unshift('sandbox_permissions=["disk-full-read-access"]');
      }
    }

    if (sandboxMode === 'workspace-write' && saved.additionalWritableRoots.length > 0) {
      const alreadyOverridesWritableRoots = configOverrides.some(
        (o) => typeof o === 'string' && o.includes('sandbox_workspace_write.writable_roots')
      );
      if (!alreadyOverridesWritableRoots) {
        const roots = cwd ? saved.additionalWritableRoots.filter((p) => p !== cwd) : saved.additionalWritableRoots;
        if (roots.length > 0) {
          configOverrides.unshift(`sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`);
        }
      }
    }

    const task = tasks.enqueue({
      ...payload,
      cwd,
      sandboxMode,
      model,
      includePlanTool,
      enableSearch,
      configOverrides,
    });
    return { ok: true, taskId: task.id, task };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:taskCancel', async (_event, taskId: string) => {
  if (!taskId || typeof taskId !== 'string') return { ok: false, error: 'Missing task id' };
  return tasks.cancel(taskId);
});

ipcMain.handle('codex:taskResume', async (_event, payload: { taskId: string; prompt: string }) => {
  const taskId = payload?.taskId;
  const prompt = payload?.prompt;
  if (!taskId || typeof taskId !== 'string') return { ok: false, error: 'Missing task id' };
  if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'Missing prompt' };
  return tasks.resume(taskId, prompt);
});

ipcMain.handle('codex:listSkills', async (_event, payload?: { cwd?: string | null }) => {
  try {
    let cwd = typeof payload?.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : null;
    if (cwd) {
      try {
        const resolved = path.resolve(cwd);
        const stats = fs.statSync(resolved);
        if (!stats.isDirectory()) cwd = null;
        else cwd = resolved;
      } catch {
        cwd = null;
      }
    }
    if (!cwd) cwd = readSettings().workspaceDir;
    if (!cwd) return { ok: true, skills: [] };
    return { ok: true, skills: listWorkspaceSkills(cwd) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
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

ipcMain.handle('codex:mcpList', async () => {
  try {
    applyCodexHomeFromSettings(readSettings());
    const res = await runBundledCodex(['mcp', 'list', '--json']);
    if (!res.ok) return { ok: false, error: res.error || 'Failed to list MCP servers' };
    const servers = JSON.parse(res.stdout);
    if (!Array.isArray(servers)) return { ok: false, error: 'Unexpected MCP list output' };
    return { ok: true, servers };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:mcpGet', async (_event, name: string) => {
  try {
    if (!name || typeof name !== 'string') return { ok: false, error: 'Missing name' };
    applyCodexHomeFromSettings(readSettings());
    const res = await runBundledCodex(['mcp', 'get', '--json', name]);
    if (!res.ok) return { ok: false, error: res.error || 'Failed to get MCP server' };
    const server = JSON.parse(res.stdout);
    return { ok: true, server };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle(
  'codex:mcpAdd',
  async (
    _event,
    payload:
      | { name: string; transport: 'stdio'; command: string; args?: string[]; env?: string[] }
      | { name: string; transport: 'http'; url: string; bearerTokenEnvVar?: string | null }
  ) => {
    try {
      const name = payload?.name;
      const transport = payload?.transport;
      if (!name || typeof name !== 'string') return { ok: false, error: 'Missing name' };
      if (transport !== 'stdio' && transport !== 'http') return { ok: false, error: 'Missing transport' };

      applyCodexHomeFromSettings(readSettings());

      const args: string[] = ['mcp', 'add'];
      if (transport === 'http') {
        const url = (payload as any).url;
        if (!url || typeof url !== 'string') return { ok: false, error: 'Missing URL' };
        args.push('--url', url);
        const bearerTokenEnvVar = (payload as any).bearerTokenEnvVar;
        if (typeof bearerTokenEnvVar === 'string' && bearerTokenEnvVar.trim()) {
          args.push('--bearer-token-env-var', bearerTokenEnvVar.trim());
        }
        args.push(name);
      } else {
        const command = (payload as any).command;
        if (!command || typeof command !== 'string') return { ok: false, error: 'Missing command' };
        const env = Array.isArray((payload as any).env) ? (payload as any).env.filter((v: unknown) => typeof v === 'string') : [];
        for (const e of env) {
          const trimmed = e.trim();
          if (!trimmed) continue;
          args.push('--env', trimmed);
        }
        const commandArgs = Array.isArray((payload as any).args)
          ? (payload as any).args.filter((v: unknown) => typeof v === 'string' && v.trim())
          : [];
        args.push(command, ...commandArgs, name);
      }

      const res = await runBundledCodex(args);
      if (!res.ok) return { ok: false, error: res.error || 'Failed to add MCP server' };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
);

ipcMain.handle('codex:mcpRemove', async (_event, name: string) => {
  try {
    if (!name || typeof name !== 'string') return { ok: false, error: 'Missing name' };
    applyCodexHomeFromSettings(readSettings());
    const res = await runBundledCodex(['mcp', 'remove', name]);
    if (!res.ok) return { ok: false, error: res.error || 'Failed to remove MCP server' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
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
    const stubMode = isStubMode();
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
  let apiKeyName: 'OPENAI_API_KEY' | 'CODEX_API_KEY' | null = null;
  if (openAiKey) {
    apiKeyName = 'OPENAI_API_KEY';
  } else if (codexKey) {
    apiKeyName = 'CODEX_API_KEY';
  }
  const stubMode = isStubMode();
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
    if (Array.isArray((patch as any)?.additionalWritableRoots)) {
      next.additionalWritableRoots = (patch as any).additionalWritableRoots.filter((v: unknown) => typeof v === 'string');
    }
    if (typeof patch?.outputDir === 'string' || patch?.outputDir === null) next.outputDir = patch.outputDir;
    if (typeof patch?.modelOverride === 'string' || patch?.modelOverride === null) next.modelOverride = patch.modelOverride;
    if (patch?.codexHomeMode === 'app' || patch?.codexHomeMode === 'global') next.codexHomeMode = patch.codexHomeMode;
    if (typeof patch?.includeFileContents === 'boolean') next.includeFileContents = patch.includeFileContents;
    if (typeof (patch as any)?.allowOutsideWorkspaceRead === 'boolean')
      next.allowOutsideWorkspaceRead = (patch as any).allowOutsideWorkspaceRead;
    if (typeof (patch as any)?.taskConcurrency === 'number') next.taskConcurrency = (patch as any).taskConcurrency;
    if (typeof (patch as any)?.experimentalSearch === 'boolean') next.experimentalSearch = (patch as any).experimentalSearch;
    if (typeof (patch as any)?.experimentalPlanTool === 'boolean') next.experimentalPlanTool = (patch as any).experimentalPlanTool;
    if (Array.isArray((patch as any)?.experimentalConfigOverrides)) {
      next.experimentalConfigOverrides = (patch as any).experimentalConfigOverrides.filter((v: unknown) => typeof v === 'string');
    }
    if (Array.isArray((patch as any)?.selectedSkills)) {
      next.selectedSkills = (patch as any).selectedSkills.filter((v: unknown) => typeof v === 'string');
    }
    if (isSandboxMode((patch as any)?.sandboxMode)) next.sandboxMode = (patch as any).sandboxMode;
    const updated = updateSettings(next);
    applyCodexHomeFromSettings(updated);
    tasks.setConcurrency(updated.taskConcurrency);
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
    payload: {
      prompt: string;
      files?: { name: string }[];
      cwd?: string;
      sandboxMode?: SandboxMode;
      modelOverride?: string | null;
      // optional overrides; most values default to Settings
      enableSearch?: boolean;
      includePlanTool?: boolean;
      selectedSkills?: string[];
    }
  ) => {
  const files = payload?.files || [];
  const stubMode = isStubMode();
  const apiKeyPresent = getApiKeyPresent();
  const saved = readSettings();
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
  const sandboxMode = isSandboxMode(payload?.sandboxMode) ? payload.sandboxMode : saved.sandboxMode;
  const modelOverride =
    typeof payload?.modelOverride === 'string' ? payload.modelOverride.trim() : saved.modelOverride?.trim() || null;
  const enableSearch = typeof payload?.enableSearch === 'boolean' ? payload.enableSearch : saved.experimentalSearch;
  const includePlanTool =
    typeof payload?.includePlanTool === 'boolean' ? payload.includePlanTool : saved.experimentalPlanTool;
  const selectedSkills = Array.isArray(payload?.selectedSkills) ? payload.selectedSkills : saved.selectedSkills;

  const allowOutsideWorkspaceRead = !!saved.allowOutsideWorkspaceRead && sandboxMode !== 'danger-full-access';
  const additionalWritableRoots = cwd ? saved.additionalWritableRoots.filter((p) => p !== cwd) : saved.additionalWritableRoots;
  const allowAdditionalWrites = sandboxMode === 'workspace-write' && additionalWritableRoots.length > 0;

  let additionalWriteSummary: string | null = null;
  if (allowAdditionalWrites) {
    const shown = additionalWritableRoots.slice(0, 2).join(', ');
    additionalWriteSummary =
      additionalWritableRoots.length > 2 ? `${shown}, … (+${additionalWritableRoots.length - 2})` : shown;
  }

  const steps: { id: string; text: string }[] = [];
  steps.push({ id: 'parse', text: 'Parse inputs and understand intent' });

  if (cwd) steps.push({ id: 'cwd', text: `Work in folder: ${cwd}` });
  if (allowAdditionalWrites) {
    let text = 'May write in additional folder(s)';
    if (additionalWriteSummary) text = `May write in additional folder(s): ${additionalWriteSummary}`;
    steps.push({ id: 'extra-write', text });
  }
  if (allowOutsideWorkspaceRead) {
    steps.push({ id: 'outside-read', text: 'May read files outside the selected folder (full disk read)' });
  }
  if (selectedSkills?.length) steps.push({ id: 'skills', text: `Use ${selectedSkills.length} skill(s)` });
  if (files.length > 0) steps.push({ id: 'read', text: `Read ${files.length} file(s)` });
  else steps.push({ id: 'noop', text: 'No external files' });
  if (!stubMode && !apiKeyPresent) steps.push({ id: 'key', text: 'Configure API key in Settings' });
  if (enableSearch) steps.push({ id: 'search', text: 'Enable web search' });
  if (includePlanTool) steps.push({ id: 'plan-tool', text: 'Enable plan tool (todos)' });
  steps.push({ id: 'gen', text: 'Generate artifact' });
  if (sandboxMode === 'danger-full-access') {
    steps.push({ id: 'full-disk', text: 'May access files outside the selected folder' });
  }
  if (sandboxMode !== 'read-only') steps.push({ id: 'writes', text: `Potentially write files (${sandboxMode})` });
  if (modelOverride) steps.push({ id: 'model', text: `Use model override: ${modelOverride}` });
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
    ...(files.length ? [{ id: 'read-files', label: `Read ${files.length} file(s)`, required: true }] : []),
    ...(!stubMode ? [{ id: 'network', label: 'Network access (model call)', required: true }] : []),
    ...(allowOutsideWorkspaceRead
      ? [{ id: 'full-disk-read', label: 'Read files outside the selected folder (full disk read)', required: true }]
      : []),
    ...(allowAdditionalWrites
      ? [{ id: 'extra-write', label: 'Write in additional folder(s) outside the workspace', required: true }]
      : []),
    ...(sandboxMode === 'danger-full-access'
      ? [{ id: 'full-disk', label: 'Access files outside the selected folder (full disk)', required: true }]
      : []),
    ...(sandboxMode !== 'read-only' ? [{ id: 'write-workspace', label: `Write files (${sandboxMode})`, required: true }] : []),
    ...mcpPermissions,
  ];

  const sources: string[] = [];
  if (cwd) sources.push(cwd);
  if (allowAdditionalWrites) sources.push(...additionalWritableRoots);
  sources.push(...files.map((f) => f.name));
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
