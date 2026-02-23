import React from 'react';
import type { TaskItem, TaskStatus, TaskSummary } from '../../main/task_types';

export type Task = TaskSummary;

function isAbsolutePath(p: string): boolean {
  if (p.startsWith('/')) return true;
  if (p.startsWith('\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

function joinPath(baseDir: string, p: string): string {
  const base = baseDir.replace(/[\\/]+$/, '');
  const rel = p.replace(/^[\\/]+/, '');
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${rel}`;
}

function resolveMaybeRelativePath(baseDir: string | null, p: string): string {
  if (!baseDir) return p;
  if (isAbsolutePath(p)) return p;
  return joinPath(baseDir, p);
}

function fileKindGlyph(kind: 'add' | 'delete' | 'update'): string {
  switch (kind) {
    case 'add':
      return '+';
    case 'delete':
      return '−';
    case 'update':
      return '•';
    default:
      return '•';
  }
}

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

  const selectedTodo = React.useMemo(() => {
    const items = selected?.items || [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type !== 'todo_list') continue;
      if (!Array.isArray(it.items) || it.items.length === 0) continue;
      return it.items;
    }
    return null;
  }, [selected?.items]);

  const selectedFileChanges = React.useMemo(() => {
    const entries = new Map<string, 'add' | 'delete' | 'update'>();
    for (const item of selected?.items || []) {
      if (item.type !== 'file_change') continue;
      for (const ch of item.changes || []) {
        if (!ch?.path || !ch?.kind) continue;
        entries.set(String(ch.path), ch.kind);
      }
    }
    const list = Array.from(entries.entries()).map(([filePath, kind]) => ({ filePath, kind }));
    list.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return list;
  }, [selected?.items]);

  const selectedCanResume =
    selected != null &&
    Boolean(selected.threadId) &&
    !resumeBusy &&
    resumeText.trim().length > 0 &&
    (selected.status === 'needs_input' || selected.status === 'completed' || selected.status === 'failed');

  const selectedShowsResumeBox =
    selected != null &&
    Boolean(selected.threadId) &&
    (selected.status === 'needs_input' || selected.status === 'completed' || selected.status === 'failed');

  const resumeHintText =
    selected?.status === 'needs_input'
      ? 'The agent asked a question. Reply to continue.'
      : 'Send a follow-up to continue this task.';

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

              {selectedTodo ? (
                <div>
                  <div className="sectionTitle">Progress</div>
                  <div className="planHint">
                    {`${selectedTodo.filter((t) => t.completed).length}/${selectedTodo.length} done`}
                  </div>
                  <ul className="todoList">
                    {selectedTodo.map((t, idx) => (
                      <li key={idx} className={`todoItem ${t.completed ? 'done' : ''}`}>
                        <span className="todoMark" aria-hidden="true">
                          {t.completed ? '✓' : '•'}
                        </span>
                        <span className="todoText">{t.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedFileChanges.length ? (
                <div>
                  <div className="sectionTitle">Files</div>
                  <ul className="fileChangeList">
                    {selectedFileChanges.map((f) => {
                      const resolved = resolveMaybeRelativePath(selected.cwd, f.filePath);
                      const canOpenPath = isAbsolutePath(resolved);
                      return (
                        <li key={`${f.kind}:${f.filePath}`} className={`fileChange ${f.kind}`}>
                          <span className="fileKind" aria-hidden="true">
                            {fileKindGlyph(f.kind)}
                          </span>
                          <button
                            className="linkButton filePathButton"
                            onClick={() => void window.codex.openPath(resolved)}
                            title={canOpenPath ? resolved : 'Cannot open relative path without a known task workspace.'}
                            disabled={!canOpenPath}
                          >
                            {f.filePath}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

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

              {selectedShowsResumeBox ? (
                <div className="planFooter">
                  <div style={{ fontWeight: 600 }}>Resume</div>
                  <div className="planHint">{resumeHintText}</div>
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
                      disabled={!selectedCanResume}
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
