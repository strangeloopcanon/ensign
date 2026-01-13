import React from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPrimaryAction: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  onDropFiles: (files: File[]) => void;
};

export function CommandBar({ value, onChange, onPrimaryAction, primaryLabel, primaryDisabled, primaryBusy, onDropFiles }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onDropFiles(files);
  };

  return (
    <div className="commandBar" data-testid="command-bar" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="commandRow">
        <input
          ref={inputRef}
          aria-label="Command"
          className="commandInput"
          type="text"
          placeholder="Type a command (e.g., ‘Summarize PDF…’)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) onPrimaryAction();
          }}
        />
        <button onClick={onPrimaryAction} disabled={primaryDisabled}>
          <span className="buttonInner">
            {primaryBusy ? <span className="spinner small" aria-hidden="true" /> : null}
            <span>{primaryLabel}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
