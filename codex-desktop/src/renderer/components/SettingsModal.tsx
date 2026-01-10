import React from 'react';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type ToastKind = 'info' | 'success' | 'error';

export type SettingsTab = 'general' | 'connection' | 'advanced';

export type Settings = {
  workspaceDir: string | null;
  outputDir: string | null;
  modelOverride: string | null;
  codexHomeMode: 'app' | 'global';
  sandboxMode: SandboxMode;
  includeFileContents: boolean;
};

type EnvInfo = {
  envPath?: string;
  apiKeyPresent?: boolean;
  apiKeyName?: 'OPENAI_API_KEY' | 'CODEX_API_KEY' | null;
  stubMode?: boolean;
};

type Props = {
  open: boolean;
  settings: Settings;
  envInfo?: EnvInfo | null;
  configPath?: string | null;
  configExists?: boolean;
  defaultTab?: SettingsTab;
  onClose: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onPickDirectory: () => Promise<string | null>;
  onSaveApiKey: (key: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onToast?: (message: string, kind?: ToastKind) => void;
};

export function SettingsModal({
  open,
  settings,
  envInfo,
  configPath,
  configExists,
  defaultTab,
  onClose,
  onSaveSettings,
  onPickDirectory,
  onSaveApiKey,
  onRefresh,
  onToast,
}: Props) {
  const [tab, setTab] = React.useState<SettingsTab>('general');
  const [draftKey, setDraftKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [verifyState, setVerifyState] = React.useState<'idle' | 'verifying' | 'valid' | 'invalid'>('idle');
  const [verifyMessage, setVerifyMessage] = React.useState('');
  const keyInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTab(defaultTab ?? 'general');
  }, [open, defaultTab]);

  React.useEffect(() => {
    setVerifyState('idle');
    setVerifyMessage('');
  }, [draftKey]);

  React.useEffect(() => {
    if (!open || tab !== 'connection') return;
    const t = setTimeout(() => keyInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, tab]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-label="Settings" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <strong>Settings</strong>
          <button onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </div>

        <div className="modalBody">
          <div className="tabRow" role="tablist" aria-label="Settings sections">
            <button
              className={`tabButton ${tab === 'general' ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === 'general'}
              onClick={() => setTab('general')}
              disabled={busy}
            >
              General
            </button>
            <button
              className={`tabButton ${tab === 'connection' ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === 'connection'}
              onClick={() => setTab('connection')}
              disabled={busy}
            >
              Connection
            </button>
            <button
              className={`tabButton ${tab === 'advanced' ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === 'advanced'}
              onClick={() => setTab('advanced')}
              disabled={busy}
            >
              Advanced
            </button>
          </div>

          {tab === 'general' ? (
            <>
              <div className="settingsGroup">
                <div className="settingsRow">
                  <div>
                    <div className="settingsLabel">Folder to work in</div>
                    <div className="settingsValue">{settings.workspaceDir || 'Not set'}</div>
                  </div>
                  <div className="settingsActions">
                    <button
                      disabled={busy}
                      onClick={async () => {
                        const p = await onPickDirectory();
                        if (!p) return;
                        setBusy(true);
                        try {
                          await onSaveSettings({ workspaceDir: p });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Choose…
                    </button>
                    <button
                      disabled={busy || !settings.workspaceDir}
                      onClick={async () => {
                        if (!settings.workspaceDir) return;
                        await window.codex.openPath(settings.workspaceDir);
                      }}
                    >
                      Open
                    </button>
                    <button
                      disabled={busy || !settings.workspaceDir}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onSaveSettings({ workspaceDir: null });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="settingsGroup">
                <div className="settingsRow">
                  <div>
                    <div className="settingsLabel">Output folder</div>
                    <div className="settingsValue">{settings.outputDir || 'Default: ~/Documents/AI Output'}</div>
                  </div>
                  <div className="settingsActions">
                    <button
                      disabled={busy}
                      onClick={async () => {
                        const p = await onPickDirectory();
                        if (!p) return;
                        setBusy(true);
                        try {
                          await onSaveSettings({ outputDir: p });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Choose…
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        await window.codex.openOutputFolder();
                      }}
                    >
                      Open
                    </button>
                    <button
                      disabled={busy || !settings.outputDir}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onSaveSettings({ outputDir: null });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>

              <div className="settingsGroup">
                <div className="settingsRow">
                  <div>
                    <div className="settingsLabel">Default model</div>
                    <div className="settingsValue">Used for runs. Clear to use config/default.</div>
                  </div>
                  <div className="settingsActions">
                    <input
                      className="settingsInput"
                      value={settings.modelOverride || ''}
                      placeholder="e.g. gpt-5.2"
                      onChange={(e) => void onSaveSettings({ modelOverride: e.target.value || null })}
                    />
                    <button
                      disabled={busy || !settings.modelOverride}
                      onClick={() => void onSaveSettings({ modelOverride: null })}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="settingsGroup">
                <div className="settingsRow">
                  <div>
                    <div className="settingsLabel">Permissions</div>
                    <div className="settingsValue">Controls what Ensign can do in your folder.</div>
                  </div>
                  <div className="settingsActions">
                    <select
                      className="settingsSelect"
                      value={settings.sandboxMode}
                      onChange={(e) => void onSaveSettings({ sandboxMode: e.target.value as SandboxMode })}
                    >
                      <option value="read-only">Read-only (safest)</option>
                      <option value="workspace-write">Write workspace</option>
                      <option value="danger-full-access">Full Write Access</option>
                    </select>
                  </div>
                </div>
                <label className="settingsCheckboxRow">
                  <input
                    type="checkbox"
                    checked={settings.includeFileContents}
                    onChange={(e) => void onSaveSettings({ includeFileContents: e.target.checked })}
                  />
                  <span>Read dropped file content into context (when possible)</span>
                </label>
              </div>
            </>
          ) : null}

          {tab === 'connection' ? (
            <div className="settingsGroup">
              <div className="settingsRow">
                <div>
                  <div className="settingsLabel">API key</div>
                  <div className="settingsValue">
                    {envInfo?.stubMode
                      ? 'Stub mode (no network/model calls)'
                      : envInfo?.apiKeyPresent
                        ? `Configured (${envInfo.apiKeyName || 'env'})`
                        : 'Not configured'}
                    {envInfo?.envPath ? ` • ${envInfo.envPath}` : ''}
                  </div>
                </div>
                <div className="settingsActions">
                  <input
                    ref={keyInputRef}
                    className="settingsInput"
                    value={draftKey}
                    type={showKey ? 'text' : 'password'}
                    placeholder="Paste API key"
                    onChange={(e) => setDraftKey(e.target.value)}
                  />
                  <button
                    disabled={!draftKey.trim() || busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onSaveApiKey(draftKey.trim());
                        setDraftKey('');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Save
                  </button>
                  <button
                    disabled={
                      busy ||
                      (!draftKey.trim() && !envInfo?.apiKeyPresent && !envInfo?.stubMode)
                    }
                    onClick={async () => {
                      setBusy(true);
                      setVerifyState('verifying');
                      try {
                        const r = await window.codex.verifyApiKey(draftKey.trim() ? draftKey.trim() : undefined);
                        if (r.ok && r.stubMode) {
                          setVerifyState('valid');
                          setVerifyMessage('Stub mode enabled (no key needed).');
                          return;
                        }
                        if (r.ok) {
                          setVerifyState('valid');
                          setVerifyMessage('Key verified.');
                          onToast?.('API key verified.', 'success');
                          return;
                        }
                        setVerifyState('invalid');
                        setVerifyMessage(r.error || 'Key verification failed.');
                        onToast?.(`API key verification failed: ${r.error || 'unknown error'}`, 'error');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {verifyState === 'verifying' ? 'Verifying…' : 'Verify'}
                  </button>
                  <button disabled={busy} onClick={() => setShowKey((v) => !v)}>
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {verifyState !== 'idle' ? (
                <div className={`verifyStatus ${verifyState}`}>
                  {verifyMessage || (verifyState === 'verifying' ? 'Verifying…' : '')}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'advanced' ? (
            <div className="settingsGroup">
              <div className="settingsRow">
                <div>
                  <div className="settingsLabel">Configuration storage</div>
                  <div className="settingsValue">
                    Storage: {settings.codexHomeMode === 'app' ? 'App-managed' : 'User (~/.codex or CODEX_HOME)'}
                    <br />
                    {configExists ? configPath : `Missing: ${configPath}`}
                  </div>
                </div>
                <div className="settingsActions">
                  <select
                    className="settingsSelect"
                    value={settings.codexHomeMode}
                    onChange={(e) => void onSaveSettings({ codexHomeMode: e.target.value as 'app' | 'global' })}
                  >
                    <option value="app">App-managed (recommended)</option>
                    <option value="global">Use existing ~/.codex</option>
                  </select>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await window.codex.initCodexConfig();
                        if (!r.ok) onToast?.(`Failed to initialize config: ${r.error || 'unknown error'}`, 'error');
                        if (r.ok) onToast?.('Config initialized.', 'success');
                        await onRefresh();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Initialize
                  </button>
                  <button
                    disabled={busy || settings.codexHomeMode !== 'app'}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await window.codex.importGlobalCodexConfig();
                        if (!r.ok) onToast?.(`Failed to import config: ${r.error || 'unknown error'}`, 'error');
                        if (r.ok) onToast?.('Imported ~/.codex config.', 'success');
                        await onRefresh();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Import from ~/.codex
                  </button>
                  <button disabled={busy} onClick={() => void window.codex.openConfig()}>
                    Open
                  </button>
                  <button disabled={busy} onClick={() => void window.codex.openMcpDocs?.()}>
                    MCP guide
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
