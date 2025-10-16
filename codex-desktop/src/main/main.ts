import { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as url from 'node:url';
import { runTask } from './codex';
import { readStatus, getConfigPath } from './config';
import dotenv from 'dotenv';
import { recordCreate, undo as txUndo, redo as txRedo, history as txHistory } from './transactions';

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
let cachedEnvPath: string | null = null;

function resolveProjectRoot(): string {
  if (isDev) return process.cwd();
  return app.getAppPath();
}

function resolveEnvPath(): string {
  if (cachedEnvPath) return cachedEnvPath;
  if (isDev) {
    cachedEnvPath = path.resolve(resolveProjectRoot(), '.env');
  } else {
    cachedEnvPath = path.join(app.getPath('userData'), '.env');
  }
  return cachedEnvPath;
}

function loadEnv() {
  const envPath = resolveEnvPath();
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
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
ipcMain.handle('codex:run', async (event, { prompt, cwd }) => {
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
    const result = await runTask({ prompt, cwd }, append);
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
    return { ok: true, path: envPath };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('codex:pickCwd', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
  return { ok: true, path: res.filePaths[0] };
});

// Plan preview: compute a simple dry-run plan and permissions
ipcMain.handle('codex:plan', async (_e, payload: { prompt: string; files?: { name: string }[] }) => {
  const files = payload?.files || [];
  const steps = [
    { id: 'parse', text: 'Parse inputs and understand intent' },
    files.length > 0 ? { id: 'read', text: `Read ${files.length} file(s)` } : { id: 'noop', text: 'No external files' },
    { id: 'gen', text: 'Generate artifact' },
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
    { id: 'network', label: 'Network access (model call)', required: true },
    ...mcpPermissions,
  ];
  const sources = files.map((f) => f.name);
  return { ok: true, plan: { steps, permissions, sources } };
});

// Save artifact deterministically with versioning
ipcMain.handle('codex:saveArtifact', async (_e, payload: { name: string; kind: 'text'; content: string }) => {
  try {
    const baseDir = path.join(app.getPath('documents'), 'AI Output');
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const safeName = payload.name.replace(/[^\w\-\s\.]+/g, '').trim() || 'artifact';
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
