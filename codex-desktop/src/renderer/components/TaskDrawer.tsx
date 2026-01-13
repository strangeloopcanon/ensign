import React from 'react';
import type { Plan } from './PlanDrawer';

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

export type Task = {
  id: string;
  title: string;
  userPrompt: string;
  cwd: string | null;
  sandboxMode: string;
  model: string | null;
  threadId?: string | null;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  outputText: string;
  plan: Plan | null;
  items: TaskItem[];
};

function formatTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'needs_input':
      return 'Needs input';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return status;
  }
}

function summarizeItem(item: TaskItem): string {
  switch (item.type) {
    case 'user_message':
      return item.text ? `You: ${item.text}` : 'You';
    case 'command_execution':
      return item.command ? `Command: ${item.command}` : 'Command';
    case 'file_change': {
      const n = item.changes?.length ?? 0;
      return n ? `Files changed: ${n}` : 'Files changed';
    }
    case 'mcp_tool_call':
      return item.server && item.tool ? `MCP: ${item.server} → ${item.tool}` : 'MCP tool call';
    case 'web_search':
      return item.query ? `Search: ${item.query}` : 'Search';
    case 'todo_list': {
      const n = item.items?.length ?? 0;
      return n ? `Plan: ${n} step(s)` : 'Plan';
    }
    case 'reasoning':
      return 'Reasoning';
    case 'error':
      return item.message ? `Error: ${item.message}` : 'Error';
    case 'agent_message':
      return 'Output';
    default:
      return item.type;
  }
}

type Props = {
  open: boolean;
  onToggle: () => void;
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onResumeTask: (taskId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>;
};

export function TaskDrawer({
  open,
  onToggle,
  tasks,
  selectedTaskId,
  onSelectTask,
  onCancelTask,
  onResumeTask,
}: Props): JSX.Element {
  const ordered = React.useMemo(() => [...tasks].sort((a, b) => b.createdAt - a.createdAt), [tasks]);
  const selected = ordered.find((t) => t.id === selectedTaskId) ?? null;
  const [resumeText, setResumeText] = React.useState('');
  const [resumeBusy, setResumeBusy] = React.useState(false);
  const [resumeError, setResumeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setResumeText('');
    setResumeBusy(false);
    setResumeError(null);
  }, [selectedTaskId]);

  const canResume =
    !!selected &&
    !!selected.threadId &&
    !resumeBusy &&
    !!resumeText.trim() &&
    (selected.status === 'needs_input' || selected.status === 'completed' || selected.status === 'failed');

  return (
    <aside className={`planDrawer ${open ? 'open' : ''}`} data-testid="task-drawer">
      <div className="planHeader">
        <strong>Tasks</strong>
        <button onClick={onToggle}>{open ? 'Close' : 'Tasks'}</button>
      </div>

      {open ? (
        <div className="planContent">
          <div>
            <div className="sectionTitle">Queue</div>
            {ordered.length === 0 ? (
              <div className="planHint">No tasks yet.</div>
            ) : (
              <ul className="taskList">
                {ordered.map((t) => {
                  const active = t.id === selectedTaskId;
                  return (
                    <li key={t.id} className={`taskRow ${active ? 'active' : ''}`}>
                      <button className="taskSelect" onClick={() => onSelectTask(t.id)}>
                        <div className="taskTop">
                          <span className={`taskStatus ${t.status}`} aria-label={`Status: ${statusLabel(t.status)}`}>
                            {statusLabel(t.status)}
                          </span>
                          <span className="taskTime">{formatTime(t.createdAt)}</span>
                        </div>
                        <div className="taskTitle">{t.title}</div>
                      </button>
                      {t.status === 'running' || t.status === 'queued' ? (
                        <button className="taskCancel" onClick={() => onCancelTask(t.id)}>
                          Stop
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selected ? (
            <>
              <div>
                <div className="sectionTitle">Activity</div>
                {selected.items?.length ? (
                  <ul className="activityList">
                    {selected.items
                      .filter((it) => it.type !== 'agent_message')
                      .map((it) => (
                        <li key={it.id} className="activityRow">
                          <div className="activitySummary">{summarizeItem(it)}</div>
                          <div className="activityMeta">
                            {it.status ? <span className={`taskStatus ${it.status}`}>{it.status}</span> : null}
                            {it.type === 'command_execution' && typeof it.exit_code === 'number' ? (
                              <span className="activityCode">{`exit ${it.exit_code}`}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <div className="planHint">No activity yet.</div>
                )}
              </div>

              {selected.plan ? (
                <div>
                  <div className="sectionTitle">Plan</div>
                  <ol>
                    {selected.plan.steps.map((s) => (
                      <li key={s.id}>{s.text}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {selected.error ? (
                <div className="planFooter">
                  <div style={{ fontWeight: 600 }}>Error</div>
                  <div className="planHint">{selected.error}</div>
                </div>
              ) : null}

              {selected.threadId && (selected.status === 'needs_input' || selected.status === 'completed' || selected.status === 'failed') ? (
                <div className="planFooter">
                  <div style={{ fontWeight: 600 }}>Resume</div>
                  <div className="planHint">{selected.status === 'needs_input' ? 'The agent asked a question. Reply to continue.' : 'Send a follow-up to continue this task.'}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      className="settingsInput"
                      style={{ flex: 1 }}
                      value={resumeText}
                      placeholder="Type a reply…"
                      onChange={(e) => setResumeText(e.target.value)}
                      disabled={resumeBusy}
                    />
                    <button
                      disabled={!canResume}
                      onClick={async () => {
                        if (!selected) return;
                        const text = resumeText.trim();
                        if (!text) return;
                        setResumeBusy(true);
                        setResumeError(null);
                        try {
                          const r = await onResumeTask(selected.id, text);
                          if (!r.ok) setResumeError(r.error || 'Failed to resume');
                          if (r.ok) setResumeText('');
                        } finally {
                          setResumeBusy(false);
                        }
                      }}
                    >
                      {resumeBusy ? 'Resuming…' : 'Resume'}
                    </button>
                  </div>
                  {resumeError ? <div className="planHint" style={{ color: '#ff9b9b' }}>{resumeError}</div> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
