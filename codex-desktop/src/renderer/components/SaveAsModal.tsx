import React from 'react';

type Props = {
  open: boolean;
  suggestedName: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
};

export function SaveAsModal({ open, suggestedName, busy, onCancel, onSave }: Props) {
  const [name, setName] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, suggestedName]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-label="Save output" onMouseDown={onCancel}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <strong>Save output</strong>
          <button onClick={onCancel} aria-label="Close save dialog">
            Close
          </button>
        </div>
        <div className="modalBody">
          <div className="settingsGroup">
            <div className="settingsRow">
              <div>
                <div className="settingsLabel">File name</div>
                <div className="settingsValue">Saved as a .txt file in your output folder.</div>
              </div>
              <div className="settingsActions">
                <input
                  ref={inputRef}
                  className="settingsInput"
                  value={name}
                  placeholder="artifact"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    void onSave(trimmed);
                  }}
                />
                <button
                  disabled={busy || !name.trim()}
                  onClick={() => {
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    void onSave(trimmed);
                  }}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

