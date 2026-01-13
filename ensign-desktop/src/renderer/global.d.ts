export {};

declare global {
  interface Window {
    codex: {
      run: (prompt: string, opts?: { cwd?: string; sandboxMode?: 'read-only'|'workspace-write'|'danger-full-access'; modelOverride?: string | null }) => Promise<{ ok: boolean; text?: string; error?: string }>;
      plan: (payload: { prompt: string; files?: { name: string }[]; cwd?: string; sandboxMode?: 'read-only'|'workspace-write'|'danger-full-access'; modelOverride?: string | null }) => Promise<{ ok: boolean; plan?: { steps: { id: string; text: string }[]; permissions: { id: string; label: string; required: boolean }[]; sources: string[] }; error?: string }>;
      taskList: () => Promise<{ ok: boolean; tasks?: any[]; error?: string }>;
      taskEnqueue: (payload: any) => Promise<{ ok: boolean; taskId?: string; task?: any; error?: string }>;
      taskCancel: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      taskResume: (payload: { taskId: string; prompt: string }) => Promise<{ ok: boolean; error?: string }>;
      listSkills: (payload?: { cwd?: string | null }) => Promise<{ ok: boolean; skills?: { id: string; name: string; description: string; instructions: string; dir: string; filePath: string }[]; error?: string }>;
      readStatus: () => Promise<{ ok: boolean; status?: { model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean }; error?: string }>;
      getEnvInfo: () => Promise<{ ok: boolean; envPath?: string; apiKeyPresent?: boolean; apiKeyName?: 'OPENAI_API_KEY'|'CODEX_API_KEY'|null; stubMode?: boolean; error?: string }>;
      getSettings: () => Promise<{ ok: boolean; settings?: { workspaceDir: string | null; additionalWritableRoots: string[]; outputDir: string | null; modelOverride: string | null; codexHomeMode: 'app'|'global'; sandboxMode: 'read-only'|'workspace-write'|'danger-full-access'; includeFileContents: boolean; allowOutsideWorkspaceRead: boolean; taskConcurrency: number; experimentalSearch: boolean; experimentalPlanTool: boolean; experimentalConfigOverrides: string[]; selectedSkills: string[] }; error?: string }>;
      updateSettings: (patch: Partial<{ workspaceDir: string | null; additionalWritableRoots: string[]; outputDir: string | null; modelOverride: string | null; codexHomeMode: 'app'|'global'; sandboxMode: 'read-only'|'workspace-write'|'danger-full-access'; includeFileContents: boolean; allowOutsideWorkspaceRead: boolean; taskConcurrency: number; experimentalSearch: boolean; experimentalPlanTool: boolean; experimentalConfigOverrides: string[]; selectedSkills: string[] }>) => Promise<{ ok: boolean; settings?: { workspaceDir: string | null; additionalWritableRoots: string[]; outputDir: string | null; modelOverride: string | null; codexHomeMode: 'app'|'global'; sandboxMode: 'read-only'|'workspace-write'|'danger-full-access'; includeFileContents: boolean; allowOutsideWorkspaceRead: boolean; taskConcurrency: number; experimentalSearch: boolean; experimentalPlanTool: boolean; experimentalConfigOverrides: string[]; selectedSkills: string[] }; error?: string }>;
      initCodexConfig: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      importGlobalCodexConfig: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      openConfig: () => Promise<{ ok: boolean; path: string; error?: string | null }>;
      saveApiKey: (key: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      verifyApiKey: (key?: string) => Promise<{ ok: boolean; stubMode?: boolean; error?: string }>;
      openMcpDocs?: () => Promise<{ ok: boolean }>; // optional in dev
      mcpList?: () => Promise<{ ok: boolean; servers?: any[]; error?: string }>;
      mcpGet?: (name: string) => Promise<{ ok: boolean; server?: any; error?: string }>;
      mcpAdd?: (payload: any) => Promise<{ ok: boolean; error?: string }>;
      mcpRemove?: (name: string) => Promise<{ ok: boolean; error?: string }>;
      pickCwd?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean } | undefined>;
      onStream?: (cb: (chunk: string) => void) => () => void;
      saveArtifact: (payload: { name: string; kind: 'text'; content: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      openOutputFolder: () => Promise<{ ok: boolean; path?: string; error?: string | null }>;
      openPath: (p: string) => Promise<{ ok: boolean; path?: string; error?: string | null }>;
      onHotkey?: (cb: (payload: { text?: string }) => void) => () => void;
      onIncomingFiles?: (cb: (paths: string[]) => void) => () => void;
      onTaskEvent?: (cb: (event: any) => void) => () => void;
      undo: () => Promise<{ ok: boolean; error?: string }>;
      redo: () => Promise<{ ok: boolean; error?: string }>;
      getHistory: () => Promise<{ ok: true; history: { id: string; kind: 'create'; path: string; ts: number; undone?: boolean }[] }>;
      readFileText: (p: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
      debugEmitFiles?: (paths: string[]) => Promise<{ ok: boolean }>;
    };
  }
}
