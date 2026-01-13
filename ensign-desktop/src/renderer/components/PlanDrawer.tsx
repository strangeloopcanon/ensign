import React from 'react';

export type Permission = { id: string; label: string; required: boolean };

export type Plan = {
  steps: { id: string; text: string }[];
  permissions: Permission[];
  sources: string[];
};

type Props = {
  plan?: Plan | null;
  open: boolean;
  onToggle: () => void;
  grants: Record<string, boolean>;
  onGrantChange: (id: string, value: boolean) => void;
  canRun?: boolean;
  running?: boolean;
  onRun?: () => void;
};

export function PlanDrawer({ plan, open, onToggle, grants, onGrantChange, canRun, running, onRun }: Props) {
  return (
    <aside className={`planDrawer ${open ? 'open' : ''}`} data-testid="plan-drawer">
      <div className="planHeader">
        <strong>Execution plan</strong>
        <button onClick={onToggle}>{open ? 'Close' : 'Plan'}</button>
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
          {typeof onRun === 'function' && (
            <div className="planFooter">
              <button onClick={onRun} disabled={!canRun || !!running}>
                {running ? 'Running…' : 'Run'}
              </button>
              {!canRun && <div className="planHint">Check required permissions to run.</div>}
            </div>
          )}
          <div>
            <div className="sectionTitle">Sources</div>
            <ul>
              {plan.sources.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </aside>
  );
}
