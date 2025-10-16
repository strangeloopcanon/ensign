import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from './components/CommandBar';
import { Canvas } from './components/Canvas';
import { DiffView } from './components/DiffView';
import { PlanDrawer, type Plan } from './components/PlanDrawer';
import { ActionBar } from './components/ActionBar';
import { HomeTemplates } from './components/HomeTemplates';
import { ClarificationChips } from './components/ClarificationChips';

type DroppedFile = { name: string; path?: string };

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
      const first = paths[0];
      const r = await window.codex.readFileText(first);
      if (r.ok && r.text) setSourceText(r.text);
    });
    window.codex.readStatus().then((r) => {
      if (r.ok && r.status) setStatus(r.status);
    }).catch((err) => console.error('Failed to read status', err));

    return () => {
      try { unsubHotkey && unsubHotkey(); } catch {}
      try { unsubFiles && unsubFiles(); } catch {}
    };
  }, []);

  const onDropFiles = (files: File[]) => {
    setDropped((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, path: (f as any).path })),
    ]);
    setHome(false);
    const firstPath = files.map((f) => (f as any).path).find(Boolean);
    if (firstPath) {
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
    const r = await window.codex.plan({ prompt, files });
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
    setRunning(true);
    const res = await window.codex.run(prompt);
    setRunning(false);
    if (res.ok) {
      setArtifact({ kind: 'text', content: res.text || '' });
    } else {
      setArtifact({ kind: 'text', content: `Error: ${res.error}` });
    }
  };

  const save = async () => {
    const name = prompt || 'artifact';
    const res = await window.codex.saveArtifact({
      name,
      kind: 'text',
      content: artifact?.content || ''
    });
    if (!res.ok) alert(`Failed to save: ${res.error}`);
  };

  const canAcceptWithPermissions = useMemo(() => {
    if (!plan || !prompt.trim()) return false;
    return plan.permissions
      .filter((p) => p.required)
      .every((p) => permissionGrants[p.id]);
  }, [plan, permissionGrants, prompt]);
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
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
