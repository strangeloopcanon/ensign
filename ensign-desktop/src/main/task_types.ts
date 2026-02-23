import type { SandboxMode } from './settings';

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
