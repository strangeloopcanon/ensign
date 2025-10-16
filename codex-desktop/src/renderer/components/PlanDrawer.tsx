import React from 'react';

export type Permission = { id: string; label: string; required: boolean };

export type Plan = {
  steps: { id: string; text: string }[];
  permissions: Permission[];
  sources: string[];
};

type Status = {
  mcpNames: string[];
  configPath: string;
  configExists: boolean;
};

type Props = {
  plan?: Plan | null;
  open: boolean;
  onToggle: () => void;
  grants: Record<string, boolean>;
  onGrantChange: (id: string, value: boolean) => void;
  status?: Status | null;
};

export function PlanDrawer({ plan, open, onToggle, grants, onGrantChange, status }: Props) {
  return (
    <aside className={`planDrawer ${open ? 'open' : ''}`} data-testid="plan-drawer">
      <div className="planHeader">
        <strong>Plan</strong>
        <button onClick={onToggle}>{open ? 'Close' : 'Open'}</button>
      </div>
      {open && plan && (
        <div className="planContent">
          <div>
            <div className="sectionTitle">Steps</div>
            <ol>
              {plan.steps.map((s) => (
                <li key={s.id}>{s.text}</li>
              ))}
            </ol>
          </div>
          <div>
            <div className="sectionTitle">Permissions</div>
            {plan.permissions.length === 0 ? (
              <div>No permissions required.</div>
            ) : (
              <ul className="permissionList">
                {plan.permissions.map((p) => (
                  <li key={p.id}>
                    <label className="permissionItem">
                      <input
                        type="checkbox"
                        checked={!!grants[p.id]}
                        onChange={(e) => onGrantChange(p.id, e.target.checked)}
                        data-testid={`permission-${p.id}`}
                      />
                      <span>{p.label}</span>
                      {p.required && <span className="chip required">Required</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="sectionTitle">Sources</div>
            <ul>
              {plan.sources.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          {status && (
            <div>
              <div className="sectionTitle">Connectors</div>
              {status.mcpNames.length ? (
                <ul>
                  {status.mcpNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <div>No MCP connectors configured. Use `codex mcp add` in the Codex CLI.</div>
              )}
              <div className="configHint">
                {status.configExists ? `Config: ${status.configPath}` : `Config missing: ${status.configPath}`}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
