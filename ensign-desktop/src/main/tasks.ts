import { BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import type { SandboxMode } from './settings';
import { resolveBundledCodexPath } from './codex_bin';

export type PlanStep = { id: string; text: string };
export type PlanPermission = { id: string; label: string; required: boolean };
export type Plan = { steps: PlanStep[]; permissions: PlanPermission[]; sources: string[] };

export type TaskStatus = 'queued' | 'running' | 'needs_input' | 'completed' | 'failed' | 'canceled';

export type TaskItemType =
  | 'user_message'
  | 'agent_message'
  | 'reasoning'
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'web_search'
  | 'todo_list'
  | 'error';

export type TaskItem = {
  id: string;
  type: TaskItemType;
  status?: 'in_progress' | 'completed' | 'failed';
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  changes?: { path: string; kind: 'add' | 'delete' | 'update' }[];
  server?: string;
  tool?: string;
  query?: string;
  items?: { text: string; completed: boolean }[];
  message?: string;
};

export type TaskSummary = {
  id: string;
  title: string;
  userPrompt: string;
  effectivePrompt: string;
  cwd: string | null;
  sandboxMode: SandboxMode;
  model: string | null;
  includePlanTool: boolean;
  enableSearch: boolean;
  configOverrides: string[];
  threadId: string | null;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  outputText: string;
  plan: Plan | null;
  items: TaskItem[];
};

export type EnqueueTaskPayload = {
  userPrompt: string;
  effectivePrompt: string;
  cwd?: string | null;
  sandboxMode: SandboxMode;
  model?: string | null;
  plan?: Plan | null;
  approvedPermissionIds?: string[];
  includePlanTool?: boolean;
  enableSearch?: boolean;
  configOverrides?: string[];
};

type TaskRuntime = {
  taskId: string;
  threadId: string | null;
  child?: ChildProcessWithoutNullStreams;
  canceled: boolean;
  stderrChunks: Buffer[];
  stubTimer?: NodeJS.Timeout;
  lastAgentTextById: Map<string, string>;
  itemsById: Map<string, TaskItem>;
  itemsOrder: string[];
  turnFailure: string | null;
};

type TaskQueueEntry =
  | { taskId: string; kind: 'new'; prompt: string }
  | { taskId: string; kind: 'resume'; prompt: string };

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      // ignore
    }
  }
}

function broadcastTaskUpdated(taskId: string, patch: Record<string, unknown>) {
  broadcast('codex:taskEvent', { type: 'task.updated', taskId, patch });
}

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || null;
}

function buildTaskTitle(prompt: string): string {
  const first = prompt.split(/\r?\n/)[0].trim();
  if (!first) return 'Task';
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

function now(): number {
  return Date.now();
}

function safeJsonParse(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function asTaskItem(raw: any): TaskItem | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || typeof raw.type !== 'string') return null;
  return raw as TaskItem;
}

function syncTaskItems(task: TaskSummary, rt: TaskRuntime) {
  task.items = rt.itemsOrder.map((id) => rt.itemsById.get(id)!).filter(Boolean);
}

function lastAssistantText(task: TaskSummary): string | null {
  for (let i = task.items.length - 1; i >= 0; i--) {
    const item = task.items[i];
    if (item.type !== 'agent_message') continue;
    if (typeof item.text !== 'string') continue;
    const trimmed = item.text.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function inferNeedsInput(task: TaskSummary): boolean {
  if (!task.threadId) return false;
  const last = lastAssistantText(task);
  if (!last) return false;
  const tail = last.slice(-300);
  return /\?\s*$/.test(tail);
}

function randomId(prefix: string): string {
  return `${prefix}-${now()}-${Math.random().toString(16).slice(2)}`;
}

function addUserMessage(task: TaskSummary, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const item: TaskItem = {
    id: randomId('user'),
    type: 'user_message',
    status: 'completed',
    text: trimmed,
  };
  task.items = [...task.items, item];
  broadcast('codex:taskEvent', { type: 'task.item', taskId: task.id, item, eventType: 'item.completed' });
}

export class TaskManager {
  private tasksById = new Map<string, TaskSummary>();
  private queue: TaskQueueEntry[] = [];
  private running = new Map<string, TaskRuntime>();
  private concurrency = 1;

  setConcurrency(n: number) {
    const next = Number.isFinite(n) ? Math.max(1, Math.min(8, Math.floor(n))) : 1;
    this.concurrency = next;
    this.drain();
  }

  listTasks(): TaskSummary[] {
    return Array.from(this.tasksById.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  enqueue(payload: EnqueueTaskPayload): TaskSummary {
    const id = `${now()}-${Math.random().toString(16).slice(2)}`;
    const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? path.resolve(payload.cwd.trim()) : null;
    const task: TaskSummary = {
      id,
      title: buildTaskTitle(payload.userPrompt),
      userPrompt: payload.userPrompt,
      effectivePrompt: payload.effectivePrompt,
      cwd,
      sandboxMode: payload.sandboxMode,
      model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : null,
      includePlanTool: !!payload.includePlanTool,
      enableSearch: !!payload.enableSearch,
      configOverrides: Array.isArray(payload.configOverrides) ? payload.configOverrides : [],
      threadId: null,
      status: 'queued',
      createdAt: now(),
      startedAt: null,
      endedAt: null,
      error: null,
      outputText: '',
      plan: payload.plan ?? null,
      items: [],
    };

    this.tasksById.set(id, task);
    this.queue.push({ taskId: id, kind: 'new', prompt: task.effectivePrompt || task.userPrompt });
    broadcast('codex:taskEvent', { type: 'task.created', task });
    this.drain();
    return task;
  }

  resume(taskId: string, userPrompt: string): { ok: boolean; error?: string } {
    const task = this.tasksById.get(taskId);
    if (!task) return { ok: false, error: 'Unknown task' };

    if (task.status === 'queued' || task.status === 'running') {
      return { ok: false, error: 'Task is already running' };
    }
    if (!task.threadId) return { ok: false, error: 'Task has no recorded session id' };
    if (typeof userPrompt !== 'string' || !userPrompt.trim()) return { ok: false, error: 'Missing prompt' };

    addUserMessage(task, userPrompt);

    task.status = 'queued';
    task.startedAt = null;
    task.endedAt = null;
    task.error = null;
    broadcastTaskUpdated(taskId, { status: task.status, startedAt: task.startedAt, endedAt: task.endedAt, error: task.error });

    this.queue.push({ taskId, kind: 'resume', prompt: userPrompt.trim() });
    this.drain();
    return { ok: true };
  }

  cancel(taskId: string): { ok: boolean; error?: string } {
    const task = this.tasksById.get(taskId);
    if (!task) return { ok: false, error: 'Unknown task' };
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') return { ok: true };

    const queuedIdx = this.queue.findIndex((q) => q.taskId === taskId);
    if (queuedIdx !== -1) {
      this.queue.splice(queuedIdx, 1);
      task.status = 'canceled';
      task.endedAt = now();
      broadcastTaskUpdated(taskId, { status: task.status, endedAt: task.endedAt });
      broadcast('codex:taskEvent', { type: 'task.finished', taskId });
      return { ok: true };
    }

    const rt = this.running.get(taskId);
    if (!rt) return { ok: false, error: 'Task not running' };
    rt.canceled = true;
    if (rt.stubTimer) clearTimeout(rt.stubTimer);
    if (rt.child && !rt.child.killed) {
      try {
        rt.child.kill();
      } catch {
        // ignore
      }
    }
    task.status = 'canceled';
    task.endedAt = now();
    broadcastTaskUpdated(taskId, { status: task.status, endedAt: task.endedAt });
    broadcast('codex:taskEvent', { type: 'task.finished', taskId });
    this.running.delete(taskId);
    this.drain();
    return { ok: true };
  }

  private drain() {
    while (this.running.size < this.concurrency && this.queue.length) {
      const entry = this.queue.shift()!;
      const taskId = entry.taskId;
      const task = this.tasksById.get(taskId);
      if (!task) continue;
      this.startTask(taskId, task, entry);
    }
  }

  private startTask(taskId: string, task: TaskSummary, entry: TaskQueueEntry) {
    task.status = 'running';
    task.startedAt = now();
    task.endedAt = null;
    task.error = null;
    broadcastTaskUpdated(taskId, { status: task.status, startedAt: task.startedAt, endedAt: task.endedAt, error: task.error });

    const rt: TaskRuntime = {
      taskId,
      threadId: task.threadId,
      canceled: false,
      stderrChunks: [],
      lastAgentTextById: new Map(),
      itemsById: new Map(),
      itemsOrder: [],
      turnFailure: null,
    };
    for (const existing of task.items) {
      rt.itemsById.set(existing.id, existing);
      rt.itemsOrder.push(existing.id);
      if (existing.type === 'agent_message' && typeof existing.text === 'string') {
        rt.lastAgentTextById.set(existing.id, existing.text);
      }
    }
    this.running.set(taskId, rt);

    const stubMode = process.env.ENSIGN_DESKTOP_FORCE_STUB === '1';
    if (stubMode) {
      const rawDelay = Number(process.env.ENSIGN_DESKTOP_STUB_DELAY_MS || '50');
      const stubDelayMs = Number.isFinite(rawDelay) ? Math.max(0, Math.floor(rawDelay)) : 50;
      rt.stubTimer = setTimeout(() => {
        if (rt.canceled) return;
        const cwd = task.cwd ?? process.cwd();
        const text = `Stub run in ${cwd}: ${task.userPrompt.slice(0, 200)}\n`;
        task.outputText += text;
        broadcast('codex:taskEvent', { type: 'task.outputDelta', taskId, delta: text });
        this.finish(taskId, task, rt, null);
      }, stubDelayMs);
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      this.finish(taskId, task, rt, 'No API key configured');
      return;
    }

    const codexPath = resolveBundledCodexPath();
    if (!codexPath) {
      this.finish(taskId, task, rt, 'Bundled Codex binary not found');
      return;
    }

    const configOverrides = Array.isArray(task.configOverrides) ? task.configOverrides : [];

    const args: string[] = [];
    if (task.enableSearch) args.push('--search');
    args.push('exec', '--json');
    if (task.model) args.push('--model', task.model);
    args.push('--sandbox', task.sandboxMode);
    if (task.cwd) args.push('--cd', task.cwd);
    args.push('--skip-git-repo-check');
    if (task.includePlanTool) args.push('--include-plan-tool');
    for (const o of configOverrides) {
      if (typeof o !== 'string') continue;
      const trimmed = o.trim();
      if (!trimmed) continue;
      args.push('-c', trimmed);
    }
    if (entry.kind === 'resume') {
      if (!task.threadId) {
        this.finish(taskId, task, rt, 'Cannot resume: no session id recorded');
        return;
      }
      args.push('resume', task.threadId, '-');
    }

    const env = { ...process.env, CODEX_API_KEY: apiKey };
    const child = spawn(codexPath, args, { env });
    rt.child = child;
    child.once('error', (err) => {
      rt.turnFailure = err?.message || 'Failed to spawn Codex';
    });
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        rt.stderrChunks.push(Buffer.from(data));
      });
    }

    if (!child.stdin || !child.stdout) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      this.finish(taskId, task, rt, 'Codex process missing stdio');
      return;
    }

    child.stdin.write(entry.prompt);
    child.stdin.end();

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line) return;
      const parsed = safeJsonParse(line);
      if (!parsed || typeof parsed !== 'object') return;
      this.onCodexEvent(taskId, task, rt, parsed as any);
    });

    child.once('exit', (code) => {
      try {
        rl.close();
      } catch {
        // ignore
      }
      if (rt.canceled) return;
      if (rt.turnFailure) {
        this.finish(taskId, task, rt, rt.turnFailure);
        return;
      }
      if (code !== 0) {
        const stderr = Buffer.concat(rt.stderrChunks).toString('utf8').trim();
        this.finish(taskId, task, rt, stderr || `Codex exited with code ${code}`);
        return;
      }
      this.finish(taskId, task, rt, null);
    });
  }

  private onCodexEvent(taskId: string, task: TaskSummary, rt: TaskRuntime, ev: any) {
    if (rt.canceled) return;
    const type = String(ev?.type || '');
    switch (type) {
      case 'thread.started': {
        const threadId = typeof ev?.thread_id === 'string' ? ev.thread_id : null;
        if (threadId && task.threadId !== threadId) {
          task.threadId = threadId;
          rt.threadId = threadId;
          broadcastTaskUpdated(taskId, { threadId });
        }
        return;
      }
      case 'error': {
        const message = typeof ev?.message === 'string' ? ev.message.trim() : '';
        if (message) {
          const item: TaskItem = { id: randomId('error'), type: 'error', status: 'failed', message };
          rt.itemsById.set(item.id, item);
          rt.itemsOrder.push(item.id);
          syncTaskItems(task, rt);
          broadcast('codex:taskEvent', { type: 'task.item', taskId, item, eventType: type });
        }
        return;
      }
      case 'turn.failed': {
        rt.turnFailure = String(ev?.error?.message || 'Turn failed');
        broadcast('codex:taskEvent', { type: 'task.turnFailed', taskId, error: rt.turnFailure });
        return;
      }
      default:
        break;
    }

    if (type !== 'item.started' && type !== 'item.updated' && type !== 'item.completed') return;
    const item = asTaskItem(ev.item);
    if (!item) return;

    if (!rt.itemsById.has(item.id)) {
      rt.itemsOrder.push(item.id);
    }
    rt.itemsById.set(item.id, item);
    syncTaskItems(task, rt);

    if (item.type === 'agent_message' && typeof item.text === 'string') {
      const prev = rt.lastAgentTextById.get(item.id) ?? '';
      const text = item.text;
      const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
      rt.lastAgentTextById.set(item.id, text);
      if (delta) {
        task.outputText += delta;
        broadcast('codex:taskEvent', { type: 'task.outputDelta', taskId, delta });
      }
    }

    broadcast('codex:taskEvent', { type: 'task.item', taskId, item, eventType: type });
  }

  private finish(taskId: string, task: TaskSummary, rt: TaskRuntime, error: string | null) {
    if (this.running.get(taskId) === rt) this.running.delete(taskId);
    task.endedAt = now();

    const finalError = error || rt.turnFailure;
    if (finalError) {
      task.status = rt.canceled ? 'canceled' : 'failed';
      task.error = finalError;
      broadcastTaskUpdated(taskId, { status: task.status, endedAt: task.endedAt, error: task.error });
    } else {
      if (rt.canceled) {
        task.status = 'canceled';
      } else if (inferNeedsInput(task)) {
        task.status = 'needs_input';
      } else {
        task.status = 'completed';
      }
      broadcastTaskUpdated(taskId, { status: task.status, endedAt: task.endedAt });
    }

    broadcast('codex:taskEvent', { type: 'task.finished', taskId });
    this.drain();
  }
}
