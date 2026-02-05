import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from './components/CommandBar';
import { Canvas } from './components/Canvas';
import { DiffView } from './components/DiffView';
import type { Plan } from './components/PlanDrawer';
import { PlanReviewModal } from './components/PlanReviewModal';
import { ActionBar } from './components/ActionBar';
import { HomeTemplates } from './components/HomeTemplates';
import { TaskDrawer, type Task, type TaskStatus } from './components/TaskDrawer';
import { SettingsModal, type Settings, type SettingsTab } from './components/SettingsModal';
import { SaveAsModal } from './components/SaveAsModal';
import { ToastHost, type Toast, type ToastKind } from './components/ToastHost';

type DroppedFile = { name: string; path?: string };

function abbreviatePath(p: string): string {
  // Light abbreviation for display only.
  return p
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^([A-Za-z]:)\\Users\\[^\\]+/i, '$1\\~');
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(10, Math.floor((max - 1) / 2));
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((i) => i.id === next.id);
  if (idx === -1) return [...items, next];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}

const DEFAULT_SETTINGS: Settings = {
  workspaceDir: null,
  additionalWritableRoots: [],
  outputDir: null,
  modelOverride: 'gpt-5.2',
  codexHomeMode: 'app',
  sandboxMode: 'read-only',
  includeFileContents: true,
  allowOutsideWorkspaceRead: false,
  taskConcurrency: 1,
  experimentalSearch: false,
  experimentalPlanTool: false,
  experimentalConfigOverrides: [],
  selectedSkills: [],
};

function App() {
  const [prompt, setPrompt] = useState('');
  const [planning, setPlanning] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planReviewOpen, setPlanReviewOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskSourceText, setTaskSourceText] = useState<Record<string, string>>({});
  const [dropped, setDropped] = useState<DroppedFile[]>([]);
  const [sourceText, setSourceText] = useState<string>('');
  const [permissionGrants, setPermissionGrants] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [envInfo, setEnvInfo] = useState<{ envPath?: string; apiKeyPresent?: boolean; apiKeyName?: 'OPENAI_API_KEY'|'CODEX_API_KEY'|null; stubMode?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('general');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveSuggestedName, setSaveSuggestedName] = useState('artifact');
  const [saveBusy, setSaveBusy] = useState(false);
  const [, setRunningTick] = useState(0);
  const previousTaskStatusesRef = useRef<Record<string, TaskStatus>>({});
  const taskStatusesHydratedRef = useRef(false);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = React.useCallback(
    (
      message: string,
      kind: ToastKind = 'info',
      options?: { actionLabel?: string; onAction?: () => void; ttlMs?: number }
    ) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const toast: Toast = { id, message, kind, actionLabel: options?.actionLabel, onAction: options?.onAction };
      setToasts((prev) => [...prev, toast]);
      let ttlMs = 4000;
      if (typeof options?.ttlMs === 'number') {
        ttlMs = options.ttlMs;
      } else if (kind === 'error') {
        ttlMs = 7000;
      }
      window.setTimeout(() => dismissToast(id), ttlMs);
    },
    [dismissToast]
  );

  const openSettings = React.useCallback((tab: SettingsTab = 'general') => {
    setSettingsDefaultTab(tab);
    setSettingsOpen(true);
  }, []);

  const focusTask = React.useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskDrawerOpen(true);
  }, []);

  const plannedInputsKey = useMemo(() => {
    const fileKey = dropped.map((f) => f.path || f.name).join('|');
    return JSON.stringify({
      prompt: prompt.trim(),
      fileKey,
      cwd: settings.workspaceDir,
      sandboxMode: settings.sandboxMode,
      modelOverride: settings.modelOverride,
      allowOutsideWorkspaceRead: settings.allowOutsideWorkspaceRead,
      additionalWritableRoots: (settings.additionalWritableRoots || []).join('|'),
      selectedSkills: (settings.selectedSkills || []).join('|'),
      experimentalSearch: settings.experimentalSearch,
      experimentalPlanTool: settings.experimentalPlanTool,
      configOverrides: (settings.experimentalConfigOverrides || []).join('|'),
    });
  }, [
    dropped,
    prompt,
    settings.experimentalConfigOverrides,
    settings.experimentalPlanTool,
    settings.experimentalSearch,
    settings.allowOutsideWorkspaceRead,
    settings.additionalWritableRoots,
    settings.modelOverride,
    settings.sandboxMode,
    settings.selectedSkills,
    settings.workspaceDir,
  ]);

  const refreshStatus = React.useCallback(async () => {
    const [s, e, st] = await Promise.allSettled([
      window.codex.readStatus(),
      window.codex.getEnvInfo(),
      window.codex.getSettings(),
    ]);
    if (st.status === 'fulfilled' && st.value.ok && st.value.settings) setSettings(st.value.settings);
    if (e.status === 'fulfilled' && e.value.ok) setEnvInfo(e.value);
    if (s.status === 'fulfilled' && s.value.ok && s.value.status) setStatus(s.value.status);
  }, []);

  useEffect(() => {
    const unsubHotkey = window.codex?.onHotkey?.((payload: { text?: string }) => {
      if (payload?.text) setPrompt(payload.text);
    });
    const unsubFiles = window.codex?.onIncomingFiles?.(async (paths: string[]) => {
      if (!paths?.length) return;
      setDropped((prev) => [
        ...prev,
        ...paths.map((p) => ({ name: p.split(/[/\\]/).pop() || p, path: p })),
      ]);
      const first = paths[0];
      const r = await window.codex.readFileText(first);
      if (r.ok && r.text) setSourceText(r.text);
    });
    const unsubTask = window.codex?.onTaskEvent?.((ev: any) => {
      if (!ev || typeof ev !== 'object') return;
      const type = String((ev as any).type || '');
      if (type === 'task.created' && (ev as any).task) {
        const task = (ev as any).task as Task;
        setTasks((prev) => [...prev, task]);
        setSelectedTaskId(task.id);
        setTaskDrawerOpen(true);
        return;
      }
      if (type === 'task.updated') {
        const taskId = String((ev as any).taskId || '');
        const patch = (ev as any).patch || {};
        if (!taskId) return;
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
        return;
      }
      if (type === 'task.outputDelta') {
        const taskId = String((ev as any).taskId || '');
        const delta = String((ev as any).delta || '');
        if (!taskId || !delta) return;
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, outputText: (t.outputText || '') + delta } : t))
        );
        return;
      }
      if (type === 'task.item') {
        const taskId = String((ev as any).taskId || '');
        const item = (ev as any).item;
        if (!taskId || !item?.id) return;
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, items: upsertById(t.items || [], item) } : t))
        );
      }
    });

    const refreshTasks = async () => {
      try {
        const res = await window.codex.taskList();
        if (res.ok && Array.isArray((res as any).tasks)) {
          const list = (res as any).tasks as Task[];
          setTasks(list);
          setSelectedTaskId((previous) => {
            if (previous != null) return previous;
            if (!list.length) return null;
            return list[list.length - 1].id;
          });
        }
      } catch {}
    };

    refreshStatus().catch((err) => console.error('Failed to read initial status', err));
    refreshTasks().catch(() => {});

    return () => {
      try { unsubHotkey && unsubHotkey(); } catch {}
      try { unsubFiles && unsubFiles(); } catch {}
      try { unsubTask && unsubTask(); } catch {}
    };
  }, [refreshStatus]);

  useEffect(() => {
    const nextStatuses: Record<string, TaskStatus> = {};
    for (const t of tasks) nextStatuses[t.id] = t.status;

    if (!taskStatusesHydratedRef.current) {
      taskStatusesHydratedRef.current = true;
      previousTaskStatusesRef.current = nextStatuses;
      return;
    }

    const prevStatuses = previousTaskStatusesRef.current;
    previousTaskStatusesRef.current = nextStatuses;

    for (const t of tasks) {
      const prev = prevStatuses[t.id];
      if (!prev) continue;
      if (prev === t.status) continue;

      if (t.status === 'needs_input') {
        pushToast(`Needs input: ${t.title}`, 'info', {
          actionLabel: 'Open',
          onAction: () => focusTask(t.id),
          ttlMs: 12_000,
        });
        continue;
      }
      if (t.status === 'completed') {
        pushToast(`Done: ${t.title}`, 'success', {
          actionLabel: 'View',
          onAction: () => focusTask(t.id),
          ttlMs: 8_000,
        });
        continue;
      }
      if (t.status === 'failed') {
        pushToast(`Failed: ${t.title}`, 'error', {
          actionLabel: 'View',
          onAction: () => focusTask(t.id),
          ttlMs: 12_000,
        });
      }
    }
  }, [focusTask, pushToast, tasks]);

  useEffect(() => {
    const anyRunning = tasks.some((t) => t.status === 'running');
    if (!anyRunning) return;
    const t = setInterval(() => setRunningTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [tasks]);

  // If inputs change after a plan is generated, force a new preview to avoid running with a stale plan.
  useEffect(() => {
    setPlan(null);
    setPermissionGrants({});
    setPlanReviewOpen(false);
  }, [plannedInputsKey]);

  const onDropFiles = (files: File[]) => {
    setDropped((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, path: (f as any).path })),
    ]);
    const firstPath = files.map((f) => (f as any).path).find(Boolean);
    if (firstPath) {
      window.codex.readFileText(firstPath).then((res) => {
        if (res.ok && res.text) setSourceText(res.text);
      }).catch((err) => console.error('Failed to read dropped file', err));
    }
  };

  const runPlan = async () => {
    if (!prompt.trim()) return;
    setPlanning(true);
    const files = dropped.map((f) => ({ name: f.name }));
    const r = await window.codex.plan({
      prompt,
      files,
      cwd: settings.workspaceDir || undefined,
      sandboxMode: settings.sandboxMode,
      modelOverride: settings.modelOverride,
    });
    setPlanning(false);
    if (r.ok && r.plan) setPlan(r.plan);
    if (r.ok && r.plan) {
      const next: Record<string, boolean> = {};
      for (const perm of r.plan.permissions) next[perm.id] = false;
      setPermissionGrants(next);
      setPlanReviewOpen(true);
    }
  };

  const acceptPlan = async () => {
    if (!plan) return;
    if (queuing) return;
    setQueuing(true);
    try {
      const userPrompt = prompt.trim();
      const required = plan.permissions.filter((p) => p.required);
      const allGranted = required.every((p) => permissionGrants[p.id]);
      if (!allGranted) {
        setPlanReviewOpen(true);
        pushToast('Review and accept required permissions first.', 'error');
        return;
      }
      if (!envInfo?.apiKeyPresent && !envInfo?.stubMode) {
        openSettings('connection');
        pushToast('Add an API key in Settings to run.', 'error');
        return;
      }
      setPlanReviewOpen(false);

      const sourceTextForTask = sourceText;
      let effectivePrompt = userPrompt;
      const approvedPermissionIds = Object.entries(permissionGrants)
        .filter(([, granted]) => granted)
        .map(([id]) => id);

      const selectedSkillIds = (settings.selectedSkills || []).filter(Boolean);
      if (selectedSkillIds.length) {
        try {
          const skillRes = await window.codex.listSkills({ cwd: settings.workspaceDir || null });
          if (skillRes.ok && Array.isArray(skillRes.skills)) {
            const chosen = skillRes.skills.filter((s) => selectedSkillIds.includes(s.id) && s.instructions);
            if (chosen.length) {
              effectivePrompt += `\n\nSkills (local instruction packs):\n`;
              for (const s of chosen) {
                const desc = s.description ? ` — ${s.description}` : '';
                effectivePrompt += `\n[Skill: ${s.name || s.id}${desc}]\n${s.instructions}\n`;
              }
            }
          }
        } catch {}
      }
      if (dropped.length) {
        const sources = dropped
          .map((f) => (f.path ? `${f.name} (${f.path})` : f.name))
          .join('\n- ');
        effectivePrompt += `\n\nSources:\n- ${sources}\n`;

        if (settings.includeFileContents) {
          let remainingBudget = 120_000;
          for (const f of dropped) {
            if (!f.path) continue;
            if (remainingBudget <= 0) break;
            const r = await window.codex.readFileText(f.path);
            if (!r.ok || !r.text) {
              effectivePrompt += `\n\n[${f.name}] (unable to read as text: ${r.error || 'unknown error'})\n`;
              continue;
            }
            const maxPerFile = 20_000;
            const chunk = r.text.slice(0, Math.min(maxPerFile, remainingBudget));
            remainingBudget -= chunk.length;
            const truncated = r.text.length > chunk.length ? '\n...[truncated]...' : '';
            effectivePrompt += `\n\n[${f.name}]\n${chunk}${truncated}\n`;
          }
        } else {
          effectivePrompt += `\nNote: file contents are not embedded. If needed, read the source files from disk.\n`;
        }
      }

      const res = await window.codex.taskEnqueue({
        userPrompt,
        effectivePrompt,
        cwd: settings.workspaceDir || null,
        sandboxMode: settings.sandboxMode,
        model: settings.modelOverride,
        plan,
        approvedPermissionIds,
        includePlanTool: settings.experimentalPlanTool,
        enableSearch: settings.experimentalSearch,
        configOverrides: settings.experimentalConfigOverrides,
      });
      if (!res.ok) {
        pushToast(`Failed to queue task: ${res.error || 'unknown error'}`, 'error');
        return;
      }

      const taskId: string | null = (res as any).taskId || (res as any).task?.id || null;
      if (taskId && sourceTextForTask) {
        setTaskSourceText((prev) => ({ ...prev, [taskId]: sourceTextForTask }));
      }

      pushToast('Task queued.', 'success');
      setSelectedTaskId(taskId);
      setTaskDrawerOpen(true);
      setPrompt('');
      setDropped([]);
      setSourceText('');
      setPlan(null);
      setPermissionGrants({});
    } finally {
      setQueuing(false);
    }
  };

  const save = async () => {
    const t = tasks.find((x) => x.id === selectedTaskId);
    const base = t?.userPrompt || prompt || 'artifact';
    const suggested = base.split(/\r?\n/)[0].slice(0, 80);
    setSaveSuggestedName(suggested || 'artifact');
    setSaveModalOpen(true);
  };

  const canAcceptWithPermissions = useMemo(() => {
    if (!plan || !prompt.trim()) return false;
    if (!envInfo?.apiKeyPresent && !envInfo?.stubMode) return false;
    return plan.permissions
      .filter((p) => p.required)
      .every((p) => permissionGrants[p.id]);
  }, [envInfo, plan, permissionGrants, prompt]);
  const canRun = !!plan && canAcceptWithPermissions;
  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [selectedTaskId, tasks]);
  const canSave = !!selectedTask?.outputText;
  const showHome = !prompt.trim() && dropped.length === 0 && !selectedTask?.outputText && tasks.length === 0;
  const needsApiKey = !!envInfo && !envInfo.apiKeyPresent && !envInfo.stubMode;
  const runningTasks = tasks.filter((t) => t.status === 'running').length;
  const queuedTasks = tasks.filter((t) => t.status === 'queued').length;
  const { needsInputCount, mostRecentNeedsInputTask } = useMemo(() => {
    let count = 0;
    let best: Task | null = null;
    for (const t of tasks) {
      if (t.status !== 'needs_input') continue;
      count += 1;
      if (!best || t.createdAt > best.createdAt) best = t;
    }
    return { needsInputCount: count, mostRecentNeedsInputTask: best };
  }, [tasks]);
  const runningSeconds =
    selectedTask?.status === 'running' && selectedTask.startedAt != null
      ? Math.max(0, Math.floor((Date.now() - selectedTask.startedAt) / 1000))
      : null;
  const workspaceLabel = settings.workspaceDir
    ? truncateMiddle(abbreviatePath(settings.workspaceDir), 44)
    : 'not set';
  const artifact = selectedTask ? { kind: 'text' as const, content: selectedTask.outputText || '' } : null;
  const selectedRunning = selectedTask?.status === 'running';
  const selectedDiffSource = selectedTask ? taskSourceText[selectedTask.id] : '';

  let commandBarPrimaryLabel = 'Generate plan';
  if (planning) commandBarPrimaryLabel = 'Planning…';
  else if (queuing) commandBarPrimaryLabel = 'Queuing…';
  else if (plan) {
    if (canRun) commandBarPrimaryLabel = 'Queue task';
    else commandBarPrimaryLabel = 'Review plan';
  }

  let llmBadgeText = 'LLM: needs key';
  if (envInfo?.stubMode) llmBadgeText = 'LLM: stub';
  else if (envInfo?.apiKeyPresent) llmBadgeText = 'LLM: ready';

  return (
    <div id="app" style={{ display: 'contents' }}>
      <CommandBar
        value={prompt}
        onChange={setPrompt}
        onPrimaryAction={() => {
          if (planning || queuing) return;
          if (!prompt.trim()) return;
          if (!plan) {
            runPlan();
            return;
          }
          if (!canRun) {
            setPlanReviewOpen(true);
            return;
          }
          acceptPlan();
        }}
        primaryLabel={commandBarPrimaryLabel}
        primaryDisabled={planning || queuing || !prompt.trim()}
        primaryBusy={planning || queuing}
        onDropFiles={onDropFiles}
      />
      <div className="toolbar" data-testid="toolbar">
        <div className="toolbarLeft">
          <span className="badge" title={settings.workspaceDir || ''}>
            {`folder: ${workspaceLabel}`}
          </span>
          <span className="badge">
            {`default model: ${settings.modelOverride || status?.model || 'default'}`}
          </span>
          <span className="badge">
            {llmBadgeText}
          </span>
          {status ? (
            <button
              className="badge badgeButton"
              onClick={() => openSettings('advanced')}
              title="Manage MCP connectors"
            >
              {`connectors: ${status.mcpNames?.length ?? 0}`}
            </button>
          ) : null}
          {mostRecentNeedsInputTask ? (
            <button
              className="badge badgeButton badgeWarning"
              onClick={() => focusTask(mostRecentNeedsInputTask.id)}
              title="Tasks waiting for your reply"
            >
              {`needs input: ${needsInputCount}`}
            </button>
          ) : null}
          {planning ? (
            <span className="badge" aria-live="polite">
              <span className="buttonInner">
                <span className="spinner small" aria-hidden="true" />
                <span>Planning…</span>
              </span>
            </span>
          ) : null}
          {runningTasks ? (
            <span className="badge" aria-live="polite">
              <span className="buttonInner">
                <span className="spinner small" aria-hidden="true" />
                <span>{`Running: ${runningTasks}${runningSeconds != null ? ` · ${runningSeconds}s` : ''}`}</span>
              </span>
            </span>
          ) : null}
          {!runningTasks && queuedTasks ? <span className="badge">{`Queued: ${queuedTasks}`}</span> : null}
          {dropped.length ? <span className="badge">{`sources: ${dropped.length}`}</span> : null}
        </div>
        <div className="toolbarRight">
          <button
            onClick={async () => {
              const res = await window.codex.pickCwd?.();
              if (!res || !res.ok || !res.path) return;
              const r = await window.codex.updateSettings({ workspaceDir: res.path });
              if (r.ok && r.settings) setSettings(r.settings);
            }}
          >
            {settings.workspaceDir ? 'Change folder…' : 'Choose folder…'}
          </button>
          {settings.workspaceDir ? (
            <button onClick={() => window.codex.openPath(settings.workspaceDir!)}>Open</button>
          ) : null}
          <button onClick={() => openSettings('general')}>Settings</button>
        </div>
      </div>
      <div className="content">
        <Canvas
          home={showHome}
          artifact={artifact}
          running={selectedRunning}
          homeContent={
            showHome && needsApiKey ? (
              <div className="homeState">
                <h1>Ensign</h1>
                <p>Add an API key to run commands.</p>
                <div className="homeActions">
                  <button onClick={() => openSettings('connection')}>Add API key</button>
                  <button onClick={() => void window.codex.openMcpDocs?.()}>MCP guide</button>
                </div>
                <p className="homeFootnote">Stored locally on this device.</p>
              </div>
            ) : undefined
          }
        >
          {showHome && (
            <HomeTemplates onPick={(t) => { setPrompt(t + ' '); }} />
          )}
          {!!artifact?.content && !!selectedDiffSource && (
            <DiffView oldText={selectedDiffSource} newText={artifact.content} />
          )}
        </Canvas>
        <TaskDrawer
          open={taskDrawerOpen}
          onToggle={() => setTaskDrawerOpen((v) => !v)}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={(id) => {
            setSelectedTaskId(id);
            setTaskDrawerOpen(true);
          }}
          onCancelTask={async (id) => {
            const r = await window.codex.taskCancel(id);
            if (!r.ok) pushToast(`Failed to cancel task: ${r.error || 'unknown error'}`, 'error');
          }}
          onResumeTask={async (taskId, reply) => {
            const r = await window.codex.taskResume({ taskId, prompt: reply });
            if (!r.ok) pushToast(`Failed to resume task: ${r.error || 'unknown error'}`, 'error');
            if (r.ok) {
              pushToast('Task resumed.', 'success');
              setSelectedTaskId(taskId);
              setTaskDrawerOpen(true);
            }
            return r;
          }}
        />
      </div>
      <ActionBar
        canSave={canSave}
        onSave={save}
        onUndo={() => window.codex.undo()}
        onRedo={() => window.codex.redo()}
      />

      <SaveAsModal
        open={saveModalOpen}
        suggestedName={saveSuggestedName}
        busy={saveBusy}
        onCancel={() => {
          if (saveBusy) return;
          setSaveModalOpen(false);
        }}
        onSave={async (name) => {
          setSaveBusy(true);
          try {
            const res = await window.codex.saveArtifact({ name, kind: 'text', content: selectedTask?.outputText || '' });
            if (!res.ok) {
              pushToast(`Failed to save: ${res.error || 'unknown error'}`, 'error');
              return;
            }
            pushToast(`Saved: ${res.path}`, 'success', {
              actionLabel: 'Open folder',
              onAction: () => void window.codex.openOutputFolder(),
              ttlMs: 10_000,
            });
            setSaveModalOpen(false);
          } finally {
            setSaveBusy(false);
          }
        }}
      />

      <PlanReviewModal
        open={planReviewOpen}
        plan={plan}
        grants={permissionGrants}
        canRun={canRun}
        running={queuing}
        needsApiKey={!!envInfo && !envInfo.apiKeyPresent && !envInfo.stubMode}
        onClose={() => setPlanReviewOpen(false)}
        onOpenSettings={() => openSettings('connection')}
        onGrantChange={(id, value) => setPermissionGrants((prev) => ({ ...prev, [id]: value }))}
        onRun={acceptPlan}
      />

      <ToastHost toasts={toasts} onDismiss={dismissToast} />

      <SettingsModal
        open={settingsOpen}
        defaultTab={settingsDefaultTab}
        settings={settings}
        envInfo={envInfo}
        configPath={status?.configPath ?? null}
        configExists={status?.configExists ?? false}
        onClose={() => setSettingsOpen(false)}
        onPickDirectory={async () => {
          const res = await window.codex.pickCwd?.();
          if (!res || !res.ok || !res.path) return null;
          return res.path;
        }}
        onSaveSettings={async (patch) => {
          const r = await window.codex.updateSettings(patch);
          if (!r.ok) pushToast(`Failed to save settings: ${r.error || 'unknown error'}`, 'error');
          if (r.ok && r.settings) setSettings(r.settings);
          await refreshStatus();
        }}
        onSaveApiKey={async (key) => {
          const r = await window.codex.saveApiKey(key);
          if (!r.ok) pushToast(`Failed to save key: ${r.error || 'unknown error'}`, 'error');
          if (r.ok) pushToast('API key saved.', 'success');
          await refreshStatus();
        }}
        onToast={pushToast}
        onRefresh={refreshStatus}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
