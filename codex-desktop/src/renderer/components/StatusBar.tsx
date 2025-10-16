import React from 'react';

export type Status = { model: string | null; auth: string | null; mcpNames: string[]; configPath: string; configExists: boolean };

export function StatusBar(props: { status: Status | null; onOpenConfig: () => void; onSaveKey: () => void; cwd?: string }) {
  const s = props.status;
  return (
    <div className="status">
      <div>
        <span className="badge">{s?.model || 'model: unknown'}</span>
        <span className="badge" style={{ marginLeft: 6 }}>{s?.auth || 'auth: ?'}</span>
        <span className="badge" style={{ marginLeft: 6 }}>MCP:{s?.mcpNames?.length ?? 0}</span>
        {s?.mcpNames?.length ? <span style={{ marginLeft: 6 }}>{s.mcpNames.join(', ')}</span> : null}
        {props.cwd ? <span className="badge" style={{ marginLeft: 6 }}>cwd: {props.cwd}</span> : null}
        {s && !s.configExists ? <span className="badge" style={{ marginLeft: 6 }}>config: missing</span> : null}
      </div>
      <div>
        <a className="settings" onClick={props.onOpenConfig} title={s?.configPath || 'Missing config'}>Open Codex config</a>
        <span> • </span>
        <a className="settings" onClick={props.onSaveKey}>Set API key</a>
        <span> • </span>
        <a className="settings" onClick={() => window.codex?.openMcpDocs?.()}>Open MCP guide</a>
      </div>
    </div>
  );
}
