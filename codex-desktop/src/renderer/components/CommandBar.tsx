import React from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  onDropFiles: (files: File[]) => void;
  chips?: React.ReactNode;
};

export function CommandBar({ value, onChange, onRun, onDropFiles, chips }: Props) {
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onDropFiles(files);
  };

  return (
    <div className="commandBar" data-testid="command-bar" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="commandRow">
        <input
          aria-label="Command"
          className="commandInput"
          type="text"
          placeholder="Type a command (e.g., ‘Summarize PDF…’)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) onRun();
          }}
        />
        <button onClick={onRun}>Run</button>
      </div>
      {chips && <div className="chipsRow">{chips}</div>}
    </div>
  );
}
