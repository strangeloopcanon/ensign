export {};

declare global {
  interface Window {
    codex: {
      run: (prompt: string, cwd?: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
      plan: (payload: { prompt: string; files?: { name: string }[] }) => Promise<{ ok: boolean; plan?: { steps: { id: string; text: string }[]; permissions: { id: string; label: string; required: boolean }[]; sources: string[] }; error?: string }>;
      readStatus: () => Promise<{ ok: boolean; status?: { model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean }; error?: string }>;
      openConfig: () => Promise<{ ok: boolean; path: string; error?: string | null }>;
      saveApiKey: (key: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      openMcpDocs?: () => Promise<{ ok: boolean }>; // optional in dev
      pickCwd?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean } | undefined>;
      onStream?: (cb: (chunk: string) => void) => () => void;
      saveArtifact: (payload: { name: string; kind: 'text'; content: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
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
