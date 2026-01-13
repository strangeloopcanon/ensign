import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function resolveBundledCodexPath(): string | null {
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

