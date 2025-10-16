import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseToml } from 'toml';

export type CodexConfig = {
  model?: string;
  preferred_auth_method?: string;
  mcp_servers?: Record<string, unknown>;
};

export function getConfigDir(): string {
  const override = process.env.CODEX_HOME;
  return override || path.join(os.homedir(), '.codex');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.toml');
}

export function readCodexConfig(): { config: CodexConfig | null; path: string; exists: boolean } {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return { config: null, path: configPath, exists: false };
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = parseToml(raw) as CodexConfig;
    return { config: parsed, path: configPath, exists: true };
  } catch (e) {
    return { config: null, path: configPath, exists: true };
  }
}

export type StatusInfo = {
  model: string | null;
  auth: string | null;
  mcpNames: string[];
  configPath: string;
  configExists: boolean;
};

export function readStatus(): StatusInfo {
  const { config, path: configPath, exists } = readCodexConfig();
  const mcpSection = (config as any)?.mcp_servers ?? {};
  const mcpNames = Object.keys(mcpSection);
  return {
    model: config?.model ?? null,
    auth: config?.preferred_auth_method ?? null,
    mcpNames,
    configPath,
    configExists: exists,
  };
}
