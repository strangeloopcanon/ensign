import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codex', {
  run: (prompt: string, opts?: { cwd?: string; sandboxMode?: string; modelOverride?: string | null }) =>
    ipcRenderer.invoke('codex:run', { prompt, ...(opts || {}) }),
  plan: (payload: { prompt: string; files?: { name: string }[]; cwd?: string; sandboxMode?: string; modelOverride?: string | null }) =>
    ipcRenderer.invoke('codex:plan', payload),
  taskList: () => ipcRenderer.invoke('codex:taskList'),
  taskEnqueue: (payload: any) => ipcRenderer.invoke('codex:taskEnqueue', payload),
  taskCancel: (taskId: string) => ipcRenderer.invoke('codex:taskCancel', taskId),
  taskResume: (payload: { taskId: string; prompt: string }) => ipcRenderer.invoke('codex:taskResume', payload),
  listSkills: (payload?: { cwd?: string | null }) => ipcRenderer.invoke('codex:listSkills', payload),
  readStatus: () => ipcRenderer.invoke('codex:readStatus'),
  getEnvInfo: () => ipcRenderer.invoke('codex:getEnvInfo'),
  getSettings: () => ipcRenderer.invoke('codex:getSettings'),
  updateSettings: (patch: any) => ipcRenderer.invoke('codex:updateSettings', patch),
  initCodexConfig: () => ipcRenderer.invoke('codex:initCodexConfig'),
  importGlobalCodexConfig: () => ipcRenderer.invoke('codex:importGlobalCodexConfig'),
  openConfig: () => ipcRenderer.invoke('codex:openConfig'),
  openMcpDocs: () => ipcRenderer.invoke('codex:openMcpDocs'),
  mcpList: () => ipcRenderer.invoke('codex:mcpList'),
  mcpGet: (name: string) => ipcRenderer.invoke('codex:mcpGet', name),
  mcpAdd: (payload: any) => ipcRenderer.invoke('codex:mcpAdd', payload),
  mcpRemove: (name: string) => ipcRenderer.invoke('codex:mcpRemove', name),
  saveApiKey: (key: string) => ipcRenderer.invoke('codex:saveApiKey', key),
  verifyApiKey: (key?: string) => ipcRenderer.invoke('codex:verifyApiKey', key),
  pickCwd: () => ipcRenderer.invoke('codex:pickCwd'),
  saveArtifact: (payload: { name: string; kind: 'text'; content: string }) => ipcRenderer.invoke('codex:saveArtifact', payload),
  openOutputFolder: () => ipcRenderer.invoke('codex:openOutputFolder'),
  openPath: (p: string) => ipcRenderer.invoke('codex:openPath', p),
  undo: () => ipcRenderer.invoke('codex:undo'),
  redo: () => ipcRenderer.invoke('codex:redo'),
  getHistory: () => ipcRenderer.invoke('codex:getHistory'),
  readFileText: (p: string) => ipcRenderer.invoke('codex:readFileText', p),
  debugEmitFiles: (paths: string[]) => ipcRenderer.invoke('codex:debugEmitFiles', paths),
  onStream: (cb: (chunk: string) => void) => {
    const listener = (_: any, chunk: string) => cb(chunk);
    ipcRenderer.on('codex:stream', listener);
    return () => ipcRenderer.removeListener('codex:stream', listener);
  },
  onHotkey: (cb: (payload: { text?: string }) => void) => {
    const fn = (_: any, payload: any) => cb(payload);
    ipcRenderer.on('codex:hotkey', fn);
    return () => ipcRenderer.removeListener('codex:hotkey', fn);
  },
  onIncomingFiles: (cb: (paths: string[]) => void) => {
    const fn = (_: any, paths: string[]) => cb(paths);
    ipcRenderer.on('codex:incomingFiles', fn);
    return () => ipcRenderer.removeListener('codex:incomingFiles', fn);
  },
  onTaskEvent: (cb: (event: any) => void) => {
    const fn = (_: any, event: any) => cb(event);
    ipcRenderer.on('codex:taskEvent', fn);
    return () => ipcRenderer.removeListener('codex:taskEvent', fn);
  },
});

export {};
