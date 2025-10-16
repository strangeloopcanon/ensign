import React from 'react';

type Props = {
  canAccept: boolean;
  running: boolean;
  onRun: () => void;
  onAccept: () => void;
  onEdit: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

export function ActionBar({ canAccept, running, onRun, onAccept, onEdit, onSave, onUndo, onRedo }: Props) {
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
      <button onClick={onRun} disabled={running}>Run</button>
      <button onClick={onAccept} disabled={!canAccept}>Accept</button>
      <button onClick={onEdit}>Edit</button>
      <button onClick={onSave} disabled={!canAccept}>Save As</button>
      <div className="spacer" />
      <button onClick={async () => { await onUndo(); refresh(); }} disabled={!canUndo}>Undo</button>
      <button onClick={async () => { await onRedo(); refresh(); }} disabled={!canRedo}>Redo</button>
    </div>
  );
}
