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
  allowOutsideWorkspaceRead: boolean;
  taskConcurrency: number;
  experimentalSearch: boolean;
  experimentalPlanTool: boolean;
  experimentalConfigOverrides: string[];
  selectedSkills: string[];
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
}: Props): JSX.Element | null {
  const [tab, setTab] = React.useState<SettingsTab>('general');
  const [draftKey, setDraftKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [skills, setSkills] = React.useState<{ id: string; name: string; description: string }[]>([]);
  const [mcpServers, setMcpServers] = React.useState<any[]>([]);
  const [mcpLoading, setMcpLoading] = React.useState(false);
  const [mcpAddTransport, setMcpAddTransport] = React.useState<'stdio' | 'http'>('stdio');
  const [mcpAddName, setMcpAddName] = React.useState('');
  const [mcpAddCommand, setMcpAddCommand] = React.useState('');
  const [mcpAddArgs, setMcpAddArgs] = React.useState('');
  const [mcpAddEnv, setMcpAddEnv] = React.useState('');
  const [mcpAddUrl, setMcpAddUrl] = React.useState('');
  const [mcpAddBearerEnvVar, setMcpAddBearerEnvVar] = React.useState('');
  const [verifyState, setVerifyState] = React.useState<'idle' | 'verifying' | 'valid' | 'invalid'>('idle');
  const [verifyMessage, setVerifyMessage] = React.useState('');
  const keyInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTab(defaultTab ?? 'general');
  }, [open, defaultTab]);

  React.useEffect(() => {
    if (!open || tab !== 'advanced') return;
    const cwd = settings.workspaceDir || null;
    window.codex
      .listSkills({ cwd })
      .then((res) => {
        if (res.ok && Array.isArray(res.skills)) {
          setSkills(res.skills.map((s) => ({ id: s.id, name: s.name, description: s.description || '' })));
        } else {
          setSkills([]);
        }
      })
      .catch(() => setSkills([]));
  }, [open, settings.workspaceDir, tab]);

  const refreshMcpServers = React.useCallback(async () => {
    if (!window.codex.mcpList) return;
    setMcpLoading(true);
    try {
      const res = await window.codex.mcpList();
      if (res.ok && Array.isArray(res.servers)) setMcpServers(res.servers);
      else setMcpServers([]);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open || tab !== 'advanced') return;
    refreshMcpServers().catch(() => setMcpServers([]));
  }, [open, refreshMcpServers, tab, settings.codexHomeMode]);

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

  let apiKeyStatusText = 'Not configured';
  if (envInfo?.stubMode) apiKeyStatusText = 'Stub mode (no network/model calls)';
  else if (envInfo?.apiKeyPresent) apiKeyStatusText = `Configured (${envInfo.apiKeyName || 'env'})`;

  const apiKeyPathSuffix = envInfo?.envPath ? ` • ${envInfo.envPath}` : '';

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
                <label className="settingsCheckboxRow">
                  <input
                    type="checkbox"
                    checked={!!settings.allowOutsideWorkspaceRead}
                    onChange={(e) => void onSaveSettings({ allowOutsideWorkspaceRead: e.target.checked })}
                  />
                  <span>Allow reading outside the selected folder (full disk read)</span>
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
                    {apiKeyStatusText}
                    {apiKeyPathSuffix}
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
            <>
              <div className="settingsGroup">
                <div className="settingsRow">
                  <div>
                    <div className="settingsLabel">Cowork mode</div>
                    <div className="settingsValue">Queue tasks, run in background, and show a structured activity log.</div>
                  </div>
                  <div className="settingsActions">
                    <select
                      className="settingsSelect"
                      value={String(settings.taskConcurrency || 1)}
                      onChange={(e) => void onSaveSettings({ taskConcurrency: Number(e.target.value) })}
                    >
                      <option value="1">Concurrency: 1</option>
                      <option value="2">Concurrency: 2</option>
                      <option value="3">Concurrency: 3</option>
                      <option value="4">Concurrency: 4</option>
                    </select>
                  </div>
                </div>
                <label className="settingsCheckboxRow">
                  <input
                    type="checkbox"
                    checked={!!settings.experimentalSearch}
                    onChange={(e) => void onSaveSettings({ experimentalSearch: e.target.checked })}
                  />
                  <span>Experimental: enable web search</span>
                </label>
                <label className="settingsCheckboxRow">
                  <input
                    type="checkbox"
                    checked={!!settings.experimentalPlanTool}
                    onChange={(e) => void onSaveSettings({ experimentalPlanTool: e.target.checked })}
                  />
                  <span>Experimental: enable plan tool (progress/todos)</span>
                </label>
                <div className="settingsRow" style={{ marginTop: 10 }}>
                  <div>
                    <div className="settingsLabel">Experimental config overrides</div>
                    <div className="settingsValue">One per line, passed to Codex as `-c key=value`.</div>
                  </div>
                  <div className="settingsActions">
                    <textarea
                      className="settingsTextArea"
                      rows={4}
                      spellCheck={false}
                      value={(settings.experimentalConfigOverrides || []).join('\n')}
                      placeholder={'model=\"gpt-5.2\"'}
                      onChange={(e) =>
                        void onSaveSettings({
                          experimentalConfigOverrides: e.target.value
                            .split(/\\r?\\n/)
                            .map((l) => l.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="sectionTitle">Skills</div>
                  {skills.length ? (
                    <ul className="permissionList">
                      {skills.map((s) => {
                        const checked = (settings.selectedSkills || []).includes(s.id);
                        return (
                          <li key={s.id}>
                            <label className="permissionItem">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={busy}
                                onChange={(e) => {
                                  const current = settings.selectedSkills || [];
                                  const next = e.target.checked ? Array.from(new Set([...current, s.id])) : current.filter((id) => id !== s.id);
                                  void onSaveSettings({ selectedSkills: next });
                                }}
                              />
                              <span>{s.name || s.id}</span>
                            </label>
                            {s.description ? (
                              <div className="planHint" style={{ marginLeft: 26 }}>
                                {s.description}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="planHint">No skills found in `.ensign/skills/` under the selected folder.</div>
                  )}
                </div>
              </div>

              <div className="settingsGroup">
                <div className="settingsRow">
                  <div>
                    <div className="settingsLabel">Connectors (MCP)</div>
                    <div className="settingsValue">
                      Manage Codex MCP servers. Stored in the selected Codex config.
                    </div>
                  </div>
                  <div className="settingsActions">
                    <button disabled={busy || mcpLoading} onClick={() => void refreshMcpServers()}>
                      {mcpLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button disabled={busy} onClick={() => void window.codex.openMcpDocs?.()}>
                      MCP guide
                    </button>
                  </div>
                </div>

                {mcpServers.length ? (
                  <ul className="taskList" style={{ marginTop: 10 }}>
                    {mcpServers.map((s) => {
                      const name = String(s?.name || '');
                      const transportType = String(s?.transport?.type || '');
                      const subtitle =
                        transportType === 'http'
                          ? String(s?.transport?.url || 'http')
                          : String(s?.transport?.command || 'stdio');
                      return (
                        <li key={name} className="taskRow" style={{ gridTemplateColumns: '1fr auto' }}>
                          <div className="taskSelect" style={{ cursor: 'default' }}>
                            <div className="taskTop">
                              <span className="taskTitle">{name}</span>
                              <span className="taskTime">{transportType}</span>
                            </div>
                            <div className="planHint">{subtitle}</div>
                          </div>
                          <button
                            className="taskCancel"
                            disabled={busy}
                            onClick={async () => {
                              if (!window.codex.mcpRemove) return;
                              setBusy(true);
                              try {
                                const r = await window.codex.mcpRemove(name);
                                if (!r.ok) onToast?.(`Failed to remove connector: ${r.error || 'unknown error'}`, 'error');
                                if (r.ok) onToast?.('Connector removed.', 'success');
                                await refreshMcpServers();
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="planHint" style={{ marginTop: 10 }}>
                    {mcpLoading ? 'Loading connectors…' : 'No MCP connectors configured.'}
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <div className="sectionTitle">Add connector</div>
                  <div className="settingsRow">
                    <div>
                      <div className="settingsLabel">Type</div>
                      <div className="settingsValue">stdio (command) or streamable HTTP.</div>
                    </div>
                    <div className="settingsActions">
                      <select
                        className="settingsSelect"
                        value={mcpAddTransport}
                        onChange={(e) => setMcpAddTransport(e.target.value as 'stdio' | 'http')}
                        disabled={busy}
                      >
                        <option value="stdio">Command (stdio)</option>
                        <option value="http">HTTP (streamable)</option>
                      </select>
                    </div>
                  </div>

                  <div className="settingsRow" style={{ marginTop: 10 }}>
                    <div>
                      <div className="settingsLabel">Name</div>
                      <div className="settingsValue">Identifier used by Codex.</div>
                    </div>
                    <div className="settingsActions">
                      <input
                        className="settingsInput"
                        value={mcpAddName}
                        placeholder="e.g. gmail"
                        onChange={(e) => setMcpAddName(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                  </div>

                  {mcpAddTransport === 'stdio' ? (
                    <>
                      <div className="settingsRow" style={{ marginTop: 10 }}>
                        <div>
                          <div className="settingsLabel">Command</div>
                          <div className="settingsValue">Executable to launch the MCP server.</div>
                        </div>
                        <div className="settingsActions">
                          <input
                            className="settingsInput"
                            value={mcpAddCommand}
                            placeholder="e.g. npx"
                            onChange={(e) => setMcpAddCommand(e.target.value)}
                            disabled={busy}
                          />
                        </div>
                      </div>
                      <div className="settingsRow" style={{ marginTop: 10 }}>
                        <div>
                          <div className="settingsLabel">Args (one per line)</div>
                          <div className="settingsValue">Optional.</div>
                        </div>
                        <div className="settingsActions">
                          <textarea
                            className="settingsTextArea"
                            rows={3}
                            spellCheck={false}
                            value={mcpAddArgs}
                            placeholder={'-y\n@mcp/server-github'}
                            onChange={(e) => setMcpAddArgs(e.target.value)}
                            disabled={busy}
                          />
                        </div>
                      </div>
                      <div className="settingsRow" style={{ marginTop: 10 }}>
                        <div>
                          <div className="settingsLabel">Env (KEY=VALUE, one per line)</div>
                          <div className="settingsValue">Optional. Stored in config.</div>
                        </div>
                        <div className="settingsActions">
                          <textarea
                            className="settingsTextArea"
                            rows={3}
                            spellCheck={false}
                            value={mcpAddEnv}
                            placeholder={'TOKEN=...'}
                            onChange={(e) => setMcpAddEnv(e.target.value)}
                            disabled={busy}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="settingsRow" style={{ marginTop: 10 }}>
                        <div>
                          <div className="settingsLabel">URL</div>
                          <div className="settingsValue">Streamable HTTP MCP server URL.</div>
                        </div>
                        <div className="settingsActions">
                          <input
                            className="settingsInput"
                            value={mcpAddUrl}
                            placeholder="https://..."
                            onChange={(e) => setMcpAddUrl(e.target.value)}
                            disabled={busy}
                          />
                        </div>
                      </div>
                      <div className="settingsRow" style={{ marginTop: 10 }}>
                        <div>
                          <div className="settingsLabel">Bearer token env var</div>
                          <div className="settingsValue">Optional env var name to read token from.</div>
                        </div>
                        <div className="settingsActions">
                          <input
                            className="settingsInput"
                            value={mcpAddBearerEnvVar}
                            placeholder="e.g. MCP_TOKEN"
                            onChange={(e) => setMcpAddBearerEnvVar(e.target.value)}
                            disabled={busy}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="settingsActions" style={{ marginTop: 10 }}>
                    <button
                      disabled={
                        busy ||
                        !window.codex.mcpAdd ||
                        !mcpAddName.trim() ||
                        (mcpAddTransport === 'stdio' ? !mcpAddCommand.trim() : !mcpAddUrl.trim())
                      }
                      onClick={async () => {
                        if (!window.codex.mcpAdd) return;
                        setBusy(true);
                        try {
                          if (mcpAddTransport === 'http') {
                            const r = await window.codex.mcpAdd({
                              name: mcpAddName.trim(),
                              transport: 'http',
                              url: mcpAddUrl.trim(),
                              bearerTokenEnvVar: mcpAddBearerEnvVar.trim() || null,
                            });
                            if (!r.ok) onToast?.(`Failed to add connector: ${r.error || 'unknown error'}`, 'error');
                            if (r.ok) onToast?.('Connector added.', 'success');
                          } else {
                            const args = mcpAddArgs
                              .split(/\r?\n/)
                              .map((l) => l.trim())
                              .filter(Boolean);
                            const env = mcpAddEnv
                              .split(/\r?\n/)
                              .map((l) => l.trim())
                              .filter(Boolean);
                            const r = await window.codex.mcpAdd({
                              name: mcpAddName.trim(),
                              transport: 'stdio',
                              command: mcpAddCommand.trim(),
                              args,
                              env,
                            });
                            if (!r.ok) onToast?.(`Failed to add connector: ${r.error || 'unknown error'}`, 'error');
                            if (r.ok) onToast?.('Connector added.', 'success');
                          }
                          setMcpAddName('');
                          setMcpAddCommand('');
                          setMcpAddArgs('');
                          setMcpAddEnv('');
                          setMcpAddUrl('');
                          setMcpAddBearerEnvVar('');
                          await refreshMcpServers();
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Add connector
                    </button>
                  </div>
                </div>
              </div>

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
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
