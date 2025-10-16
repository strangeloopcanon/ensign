import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codex', {
  run: (prompt: string, cwd?: string) => ipcRenderer.invoke('codex:run', { prompt, cwd }),
  plan: (payload: { prompt: string; files?: { name: string }[] }) => ipcRenderer.invoke('codex:plan', payload),
  readStatus: () => ipcRenderer.invoke('codex:readStatus'),
  openConfig: () => ipcRenderer.invoke('codex:openConfig'),
  openMcpDocs: () => ipcRenderer.invoke('codex:openMcpDocs'),
  saveApiKey: (key: string) => ipcRenderer.invoke('codex:saveApiKey', key),
  pickCwd: () => ipcRenderer.invoke('codex:pickCwd'),
  saveArtifact: (payload: { name: string; kind: 'text'; content: string }) => ipcRenderer.invoke('codex:saveArtifact', payload),
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
});

export {};
