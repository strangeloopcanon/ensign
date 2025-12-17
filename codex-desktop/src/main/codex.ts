// Thin wrapper around Codex SDK; falls back to a stub when not configured.
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { app } from 'electron';
import type { SandboxMode } from './settings';

export type RunOptions = {
  prompt: string;
  cwd?: string;
  sandboxMode?: SandboxMode;
  modelOverride?: string | null;
};

export type StreamHandler = (chunk: string) => void;

type ThreadEvent = { type: string; [key: string]: any };
type CodexThread = { runStreamed: (input: string) => Promise<{ events: AsyncGenerator<ThreadEvent> }> };
type CodexClient = {
  startThread: (options?: {
    model?: string;
    sandboxMode?: SandboxMode;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
  }) => CodexThread;
};
type CodexSdk = { Codex: new (options: { apiKey?: string; codexPathOverride?: string }) => CodexClient };

let sdk: CodexSdk | null = null;
let codexClient: CodexClient | null = null;

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || null;
}

function resolveBundledCodexPath(): string | null {
  const { platform, arch } = process;
  let targetTriple: string | null = null;
  switch (platform) {
    case 'linux':
    case 'android':
      if (arch === 'x64') targetTriple = 'x86_64-unknown-linux-musl';
      if (arch === 'arm64') targetTriple = 'aarch64-unknown-linux-musl';
      break;
    case 'darwin':
      if (arch === 'x64') targetTriple = 'x86_64-apple-darwin';
      if (arch === 'arm64') targetTriple = 'aarch64-apple-darwin';
      break;
    case 'win32':
      if (arch === 'x64') targetTriple = 'x86_64-pc-windows-msvc';
      if (arch === 'arm64') targetTriple = 'aarch64-pc-windows-msvc';
      break;
    default:
      break;
  }
  if (!targetTriple) return null;

  const codexBinaryName = platform === 'win32' ? 'codex.exe' : 'codex';
  const baseRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath();
  const binaryPath = path.join(
    baseRoot,
    'node_modules',
    '@openai',
    'codex-sdk',
    'vendor',
    targetTriple,
    'codex',
    codexBinaryName
  );
  if (!fs.existsSync(binaryPath)) return null;
  return binaryPath;
}

async function importCodexSdk(): Promise<CodexSdk | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    return (await importer('@openai/codex-sdk')) as CodexSdk;
  } catch {
    return null;
  }
}

async function ensureClient(): Promise<CodexClient | null> {
  if (codexClient) return codexClient;
  if (process.env.CODEX_DESKTOP_FORCE_STUB === '1') return null;
  const apiKey = getApiKey();
  if (!apiKey) return null;

  if (!sdk) sdk = await importCodexSdk();
  if (!sdk?.Codex) return null;

  const codexPathOverride = resolveBundledCodexPath() || undefined;
  codexClient = new sdk.Codex({ apiKey, codexPathOverride });
  return codexClient;
}

export async function runTask(opts: RunOptions, onData?: StreamHandler): Promise<string> {
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const client = await ensureClient();

  if (!client) {
    const text = `Stub run in ${cwd}: ` + opts.prompt.slice(0, 200);
    if (onData) onData(text + '\n');
    return text;
  }

  const sandboxMode: SandboxMode = opts.sandboxMode ?? 'read-only';
  const model = typeof opts.modelOverride === 'string' && opts.modelOverride.trim() ? opts.modelOverride.trim() : undefined;

  const thread = client.startThread({
    workingDirectory: cwd,
    sandboxMode,
    model,
    skipGitRepoCheck: true,
  });

  const streamed = await thread.runStreamed(opts.prompt);
  const lastTextById = new Map<string, string>();
  let aggregated = '';

  for await (const ev of streamed.events) {
    if (ev.type === 'turn.failed') {
      throw new Error(ev.error.message);
    }
    if (ev.type !== 'item.updated' && ev.type !== 'item.completed') continue;
    const item: any = (ev as any).item;
    if (!item || item.type !== 'agent_message') continue;
    const prev = lastTextById.get(item.id) ?? '';
    const text = String(item.text ?? '');
    const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
    lastTextById.set(item.id, text);
    if (delta) {
      aggregated += delta;
      if (onData) onData(delta);
    }
  }

  if (aggregated) return aggregated;
  const values = Array.from(lastTextById.values());
  return values.length ? values[values.length - 1] : '';
}
