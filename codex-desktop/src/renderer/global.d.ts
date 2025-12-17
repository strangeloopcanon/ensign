export {};

declare global {
  interface Window {
    codex: {
      run: (prompt: string, opts?: { cwd?: string; sandboxMode?: 'read-only'|'workspace-write'|'danger-full-access'; modelOverride?: string | null }) => Promise<{ ok: boolean; text?: string; error?: string }>;
      plan: (payload: { prompt: string; files?: { name: string }[]; cwd?: string; sandboxMode?: 'read-only'|'workspace-write'|'danger-full-access'; modelOverride?: string | null }) => Promise<{ ok: boolean; plan?: { steps: { id: string; text: string }[]; permissions: { id: string; label: string; required: boolean }[]; sources: string[] }; error?: string }>;
      readStatus: () => Promise<{ ok: boolean; status?: { model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean }; error?: string }>;
      getEnvInfo: () => Promise<{ ok: boolean; envPath?: string; apiKeyPresent?: boolean; apiKeyName?: 'OPENAI_API_KEY'|'CODEX_API_KEY'|null; stubMode?: boolean; error?: string }>;
      getSettings: () => Promise<{ ok: boolean; settings?: { workspaceDir: string | null; outputDir: string | null; modelOverride: string | null; codexHomeMode: 'app'|'global'; sandboxMode: 'read-only'|'workspace-write'|'danger-full-access'; includeFileContents: boolean }; error?: string }>;
      updateSettings: (patch: Partial<{ workspaceDir: string | null; outputDir: string | null; modelOverride: string | null; codexHomeMode: 'app'|'global'; sandboxMode: 'read-only'|'workspace-write'|'danger-full-access'; includeFileContents: boolean }>) => Promise<{ ok: boolean; settings?: { workspaceDir: string | null; outputDir: string | null; modelOverride: string | null; codexHomeMode: 'app'|'global'; sandboxMode: 'read-only'|'workspace-write'|'danger-full-access'; includeFileContents: boolean }; error?: string }>;
      initCodexConfig: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      importGlobalCodexConfig: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      openConfig: () => Promise<{ ok: boolean; path: string; error?: string | null }>;
      saveApiKey: (key: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      openMcpDocs?: () => Promise<{ ok: boolean }>; // optional in dev
      pickCwd?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean } | undefined>;
      onStream?: (cb: (chunk: string) => void) => () => void;
      saveArtifact: (payload: { name: string; kind: 'text'; content: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      openOutputFolder: () => Promise<{ ok: boolean; path?: string; error?: string | null }>;
      openPath: (p: string) => Promise<{ ok: boolean; path?: string; error?: string | null }>;
      onHotkey?: (cb: (payload: { text?: string }) => void) => () => void;
      onIncomingFiles?: (cb: (paths: string[]) => void) => () => void;
      undo: () => Promise<{ ok: boolean; error?: string }>;
      redo: () => Promise<{ ok: boolean; error?: string }>;
      getHistory: () => Promise<{ ok: true; history: { id: string; kind: 'create'; path: string; ts: number; undone?: boolean }[] }>;
      readFileText: (p: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
      debugEmitFiles?: (paths: string[]) => Promise<{ ok: boolean }>;
    };
  }
}
