import React from 'react';
import type { Plan, Permission } from './PlanDrawer';

type PermissionGroup = {
  id: 'files' | 'network' | 'connectors' | 'other';
  title: string;
  icon: string;
  items: Permission[];
};

function groupPermissions(perms: Permission[]): PermissionGroup[] {
  const files: Permission[] = [];
  const network: Permission[] = [];
  const connectors: Permission[] = [];
  const other: Permission[] = [];

  for (const p of perms) {
    if (p.id === 'network') network.push(p);
    else if (p.id === 'read-files' || p.id === 'write-workspace' || p.id === 'full-disk' || p.id === 'full-disk-read')
      files.push(p);
    else if (p.id.startsWith('mcp-')) connectors.push(p);
    else other.push(p);
  }

  const out: PermissionGroup[] = [];
  if (files.length) out.push({ id: 'files', title: 'File system', icon: '🔒', items: files });
  if (network.length) out.push({ id: 'network', title: 'Network', icon: '🌐', items: network });
  if (connectors.length) out.push({ id: 'connectors', title: 'Connectors', icon: '🔌', items: connectors });
  if (other.length) out.push({ id: 'other', title: 'Other', icon: '⚙️', items: other });
  return out;
}

type Props = {
  open: boolean;
  plan: Plan | null;
  grants: Record<string, boolean>;
  running?: boolean;
  canRun?: boolean;
  needsApiKey?: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onGrantChange: (id: string, value: boolean) => void;
  onRun: () => void;
};

export function PlanReviewModal({
  open,
  plan,
  grants,
  running,
  canRun,
  needsApiKey,
  onClose,
  onOpenSettings,
  onGrantChange,
  onRun,
}: Props): JSX.Element | null {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !plan) return null;

  const groups = groupPermissions(plan.permissions);

  return (
    <div
      ref={overlayRef}
      className="modalOverlay"
      role="dialog"
      aria-label="Execution plan"
      onMouseDown={onClose}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <strong>Execution plan</strong>
          <button onClick={onClose} aria-label="Close plan review">
            Close
          </button>
        </div>

        <div className="modalBody">
          <div className="settingsGroup">
            <div className="sectionTitle">Steps</div>
            <ol>
              {plan.steps.map((s) => (
                <li key={s.id}>{s.text}</li>
              ))}
            </ol>
          </div>

          <div className="settingsGroup">
            <div className="sectionTitle">Permissions</div>
            {plan.permissions.length === 0 ? (
              <div>No permissions required.</div>
            ) : (
              <div className="permissionGroups">
                {groups.map((g) => (
                  <div key={g.id} className="permissionGroup">
                    <div className="permissionGroupHeader">
                      <span className="permIcon" aria-hidden="true">
                        {g.icon}
                      </span>
                      <span>{g.title}</span>
                    </div>
                    <ul className="permissionList">
                      {g.items.map((p) => (
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
                  </div>
                ))}
              </div>
            )}
            {needsApiKey ? (
              <div className="planHint" style={{ marginTop: 10 }}>
                Missing API key.{' '}
                <button className="linkButton" onClick={onOpenSettings}>
                  Add API key in Settings
                </button>
                .
              </div>
            ) : null}
          </div>

          <div className="settingsGroup">
            <div className="sectionTitle">Sources</div>
            <ul>
              {plan.sources.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>

          <div className="planFooter">
            <button onClick={onRun} disabled={!canRun || !!running}>
              {running ? 'Running…' : 'Run'}
            </button>
            {!canRun && !needsApiKey ? <div className="planHint">Check required permissions to run.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
