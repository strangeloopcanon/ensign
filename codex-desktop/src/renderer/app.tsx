import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from './components/CommandBar';
import { Canvas } from './components/Canvas';
import { DiffView } from './components/DiffView';
import { PlanDrawer, type Plan } from './components/PlanDrawer';
import { ActionBar } from './components/ActionBar';
import { HomeTemplates } from './components/HomeTemplates';
import { ClarificationChips } from './components/ClarificationChips';
import { SettingsModal, type Settings } from './components/SettingsModal';

type DroppedFile = { name: string; path?: string };

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
  const [planOpen, setPlanOpen] = useState(true);
  const [artifact, setArtifact] = useState<{ kind: 'text'; name?: string; content: string } | null>(null);
  const [dropped, setDropped] = useState<DroppedFile[]>([]);
  const [home, setHome] = useState(true);
  const [sourceText, setSourceText] = useState<string>('');
  const [permissionGrants, setPermissionGrants] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [envInfo, setEnvInfo] = useState<{ envPath?: string; apiKeyPresent?: boolean; apiKeyName?: 'OPENAI_API_KEY'|'CODEX_API_KEY'|null; stubMode?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const clarificationChips = useMemo(
    () => [
      { id: 'tone', label: 'Tone?', text: 'tone: friendly' },
      { id: 'length', label: 'Length?', text: 'limit to two paragraphs' },
      { id: 'target', label: 'Target app?', text: 'target app: Keynote' },
      { id: 'format', label: 'Format?', text: 'output as a bullet list' },
      { id: 'language', label: 'Language?', text: 'write in Spanish' },
    ],
    []
  );

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
    }
  };

  const acceptPlan = async () => {
    if (!plan) return;
    const required = plan.permissions.filter((p) => p.required);
    const allGranted = required.every((p) => permissionGrants[p.id]);
    if (!allGranted) {
      alert('Review and accept required permissions first.');
      return;
    }
    if (!envInfo?.apiKeyPresent && !envInfo?.stubMode) {
      setSettingsOpen(true);
      alert('Add an API key in Settings to run Codex.');
      return;
    }
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

    const res = await window.codex.run(effectivePrompt, {
      cwd: settings.workspaceDir || undefined,
      sandboxMode: settings.sandboxMode,
      modelOverride: settings.modelOverride,
    });
    setRunning(false);
    try { unsub && unsub(); } catch {}
    if (res.ok) {
      setArtifact({ kind: 'text', content: res.text || streamed || '' });
    } else {
      setArtifact({ kind: 'text', content: `Error: ${res.error}` });
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
  const canSave = !!artifact?.content;

  return (
    <div id="app" style={{ display: 'contents' }}>
      <CommandBar
        value={prompt}
        onChange={setPrompt}
        onRun={runPlan}
        onDropFiles={onDropFiles}
        chips={(
          <ClarificationChips
            chips={clarificationChips}
            onPick={(chip) => {
              setPrompt((prev) => {
                if (prev.includes(chip.text)) return prev;
                const spacer = prev.trim().length ? ' ' : '';
                return prev + spacer + chip.text;
              });
            }}
          />
        )}
      />
      <div className="toolbar" data-testid="toolbar">
        <div className="toolbarLeft">
          <span className="badge">{settings.workspaceDir ? `workspace: ${settings.workspaceDir}` : 'workspace: none'}</span>
          <span className="badge">
            {`model: ${settings.modelOverride || status?.model || 'default'}`}
          </span>
          <span className="badge">
            {envInfo?.stubMode ? 'LLM: stub' : envInfo?.apiKeyPresent ? 'LLM: ready' : 'LLM: needs key'}
          </span>
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
            Choose folder…
          </button>
          <button disabled={!settings.workspaceDir} onClick={() => settings.workspaceDir && window.codex.openPath(settings.workspaceDir)}>
            Open folder
          </button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </div>
      <div className="content">
        <Canvas home={home} artifact={artifact}>
          {home && (
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
          status={status}
        />
      </div>
      <ActionBar
        canAccept={canAcceptWithPermissions}
        canSave={canSave}
        running={running}
        onRun={runPlan}
        onAccept={acceptPlan}
        onEdit={() => {
          setPlan(null);
          setPermissionGrants({});
        }}
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
