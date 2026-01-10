import React from 'react';

type Props = {
  canSave: boolean;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

export function ActionBar({ canSave, onSave, onUndo, onRedo }: Props) {
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const h = await window.codex.getHistory();
      const items = h.history || [];
      setCanUndo(items.some((e) => !e.undone));
      setCanRedo(items.some((e) => e.undone));
    } catch {}
  }, []);

  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="actionBar" data-testid="action-bar">
      <button onClick={onSave} disabled={!canSave}>Save As</button>
      <div className="spacer" />
      <button onClick={async () => { await onUndo(); refresh(); }} disabled={!canUndo}>Undo</button>
      <button onClick={async () => { await onRedo(); refresh(); }} disabled={!canRedo}>Redo</button>
    </div>
  );
}
