import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from './components/CommandBar';
import { Canvas } from './components/Canvas';
import { DiffView } from './components/DiffView';
import { PlanDrawer, type Plan } from './components/PlanDrawer';
import { ActionBar } from './components/ActionBar';
import { HomeTemplates } from './components/HomeTemplates';
import { SettingsModal, type Settings } from './components/SettingsModal';

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

const DEFAULT_SETTINGS: Settings = {
  workspaceDir: null,
  outputDir: null,
  modelOverride: 'gpt-5.2',
  codexHomeMode: 'app',
  sandboxMode: 'read-only',
  includeFileContents: true,
};

function App() {
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [artifact, setArtifact] = useState<{ kind: 'text'; name?: string; content: string } | null>(null);
  const [dropped, setDropped] = useState<DroppedFile[]>([]);
  const [home, setHome] = useState(true);
  const [sourceText, setSourceText] = useState<string>('');
  const [permissionGrants, setPermissionGrants] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [envInfo, setEnvInfo] = useState<{ envPath?: string; apiKeyPresent?: boolean; apiKeyName?: 'OPENAI_API_KEY'|'CODEX_API_KEY'|null; stubMode?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const runStartedAtRef = React.useRef<number | null>(null);
  const [, setRunningTick] = useState(0);

  const plannedInputsKey = useMemo(() => {
    const fileKey = dropped.map((f) => f.path || f.name).join('|');
    return JSON.stringify({
      prompt: prompt.trim(),
      fileKey,
      cwd: settings.workspaceDir,
      sandboxMode: settings.sandboxMode,
      modelOverride: settings.modelOverride,
    });
  }, [dropped, prompt, settings.modelOverride, settings.sandboxMode, settings.workspaceDir]);

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
      setHome(false);
      setDropped((prev) => [
        ...prev,
        ...paths.map((p) => ({ name: p.split(/[/\\]/).pop() || p, path: p })),
      ]);
      // If the user hasn't chosen a workspace yet, default to the first file's folder.
      if (!settings.workspaceDir && paths[0]) {
        const dir = paths[0].replace(/[/\\][^/\\]+$/, '');
        if (dir) {
          window.codex.updateSettings({ workspaceDir: dir }).then((r) => {
            if (r.ok && r.settings) setSettings(r.settings);
          }).catch(() => {});
        }
      }
      const first = paths[0];
      const r = await window.codex.readFileText(first);
      if (r.ok && r.text) setSourceText(r.text);
    });
    refreshStatus().catch((err) => console.error('Failed to read initial status', err));

    return () => {
      try { unsubHotkey && unsubHotkey(); } catch {}
      try { unsubFiles && unsubFiles(); } catch {}
    };
  }, [refreshStatus, settings.workspaceDir]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setRunningTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // If inputs change after a plan is generated, force a new preview to avoid running with a stale plan.
  useEffect(() => {
    setPlan(null);
    setPermissionGrants({});
  }, [plannedInputsKey]);

  // First-run onboarding: prompt for API key unless stub mode is explicitly enabled.
  const didAutoOpenSettings = React.useRef(false);
  useEffect(() => {
    if (didAutoOpenSettings.current) return;
    if (envInfo && !envInfo.apiKeyPresent && !envInfo.stubMode) {
      setSettingsOpen(true);
      didAutoOpenSettings.current = true;
    }
  }, [envInfo]);

  const onDropFiles = (files: File[]) => {
    setDropped((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, path: (f as any).path })),
    ]);
    setHome(false);
    const firstPath = files.map((f) => (f as any).path).find(Boolean);
    if (firstPath) {
      if (!settings.workspaceDir) {
        const dir = String(firstPath).replace(/[/\\][^/\\]+$/, '');
        if (dir) {
          window.codex.updateSettings({ workspaceDir: dir }).then((r) => {
            if (r.ok && r.settings) setSettings(r.settings);
          }).catch(() => {});
        }
      }
      window.codex.readFileText(firstPath).then((res) => {
        if (res.ok && res.text) setSourceText(res.text);
      }).catch((err) => console.error('Failed to read dropped file', err));
    }
  };

  const runPlan = async () => {
    if (!prompt.trim()) return;
    setRunning(true);
    setHome(false);
    const files = dropped.map((f) => ({ name: f.name }));
    const r = await window.codex.plan({
      prompt,
      files,
      cwd: settings.workspaceDir || undefined,
      sandboxMode: settings.sandboxMode,
      modelOverride: settings.modelOverride,
    });
    setRunning(false);
    if (r.ok && r.plan) setPlan(r.plan);
    if (r.ok && r.plan) {
      const next: Record<string, boolean> = {};
      for (const perm of r.plan.permissions) next[perm.id] = false;
      setPermissionGrants(next);
      setPlanOpen(true);
    }
  };

  const acceptPlan = async () => {
    if (!plan) return;
    const required = plan.permissions.filter((p) => p.required);
    const allGranted = required.every((p) => permissionGrants[p.id]);
    if (!allGranted) {
      setPlanOpen(true);
      alert('Review and accept required permissions first.');
      return;
    }
    if (!envInfo?.apiKeyPresent && !envInfo?.stubMode) {
      setSettingsOpen(true);
      alert('Add an API key in Settings to run Codex.');
      return;
    }
    setPlanOpen(false);
    runStartedAtRef.current = Date.now();
    setRunning(true);
    setArtifact({ kind: 'text', content: '' });
    let streamed = '';
    const unsub = window.codex.onStream?.((chunk) => {
      streamed += chunk;
      setArtifact({ kind: 'text', content: streamed });
    });

    let effectivePrompt = prompt.trim();
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

    try {
      const res = await window.codex.run(effectivePrompt, {
        cwd: settings.workspaceDir || undefined,
        sandboxMode: settings.sandboxMode,
        modelOverride: settings.modelOverride,
      });
      if (res.ok) {
        setArtifact({ kind: 'text', content: res.text || streamed || '' });
      } else {
        setArtifact({ kind: 'text', content: `Error: ${res.error}` });
      }
    } finally {
      setRunning(false);
      runStartedAtRef.current = null;
      try { unsub && unsub(); } catch {}
    }
  };

  const save = async () => {
    const suggested = (prompt || 'artifact').split(/\r?\n/)[0].slice(0, 80);
    const name = window.prompt('Save as', suggested) || '';
    if (!name.trim()) return;
    const res = await window.codex.saveArtifact({
      name,
      kind: 'text',
      content: artifact?.content || ''
    });
    if (!res.ok) alert(`Failed to save: ${res.error}`);
    else alert(`Saved: ${res.path}`);
  };

  const canAcceptWithPermissions = useMemo(() => {
    if (!plan || !prompt.trim()) return false;
    if (!envInfo?.apiKeyPresent && !envInfo?.stubMode) return false;
    return plan.permissions
      .filter((p) => p.required)
      .every((p) => permissionGrants[p.id]);
  }, [envInfo, plan, permissionGrants, prompt]);
  const canRun = !!plan && canAcceptWithPermissions;
  const canSave = !!artifact?.content;
  const showHome = home && !prompt.trim() && dropped.length === 0 && !artifact?.content;
  const runningSeconds =
    running && runStartedAtRef.current != null ? Math.max(0, Math.floor((Date.now() - runStartedAtRef.current) / 1000)) : null;
  const workspaceLabel = settings.workspaceDir
    ? truncateMiddle(abbreviatePath(settings.workspaceDir), 44)
    : 'not set';

  return (
    <div id="app" style={{ display: 'contents' }}>
      <CommandBar
        value={prompt}
        onChange={setPrompt}
        onPrimaryAction={() => {
          if (running) return;
          if (!prompt.trim()) return;
          if (!plan) {
            runPlan();
            return;
          }
          if (!canRun) {
            setPlanOpen(true);
            return;
          }
          acceptPlan();
        }}
        primaryLabel={running ? 'Running…' : plan ? (canRun ? 'Run' : 'Review plan') : 'Preview plan'}
        primaryDisabled={running || !prompt.trim()}
        primaryBusy={running}
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
            {envInfo?.stubMode ? 'LLM: stub' : envInfo?.apiKeyPresent ? 'LLM: ready' : 'LLM: needs key'}
          </span>
          {running ? (
            <span className="badge" aria-live="polite">
              <span className="buttonInner">
                <span className="spinner small" aria-hidden="true" />
                <span>{`Running${runningSeconds != null ? ` · ${runningSeconds}s` : ''}`}</span>
              </span>
            </span>
          ) : null}
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
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>
      <div className="content">
        <Canvas home={showHome} artifact={artifact} running={running}>
          {showHome && (
            <HomeTemplates onPick={(t) => { setPrompt(t + ' '); }} />
          )}
          {!!artifact?.content && !!sourceText && (
            <DiffView oldText={sourceText} newText={artifact.content} />
          )}
        </Canvas>
        <PlanDrawer
          plan={plan}
          open={planOpen}
          onToggle={() => setPlanOpen((v) => !v)}
          grants={permissionGrants}
          onGrantChange={(id, value) => setPermissionGrants((prev) => ({ ...prev, [id]: value }))}
          canRun={canRun}
          running={running}
          onRun={acceptPlan}
        />
      </div>
      <ActionBar
        canSave={canSave}
        onSave={save}
        onUndo={() => window.codex.undo()}
        onRedo={() => window.codex.redo()}
      />

      <SettingsModal
        open={settingsOpen}
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
          if (!r.ok) alert(`Failed to save settings: ${r.error}`);
          if (r.ok && r.settings) setSettings(r.settings);
          await refreshStatus();
        }}
        onSaveApiKey={async (key) => {
          const r = await window.codex.saveApiKey(key);
          if (!r.ok) alert(`Failed to save key: ${r.error}`);
          await refreshStatus();
        }}
        onRefresh={refreshStatus}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
