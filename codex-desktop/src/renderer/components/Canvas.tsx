import React from 'react';

type Artifact = {
  kind: 'text';
  name?: string;
  content: string;
};

type Props = {
  home: boolean;
  artifact?: Artifact | null;
  running?: boolean;
  children?: React.ReactNode; // for overlays like diffs later
};

export function Canvas({ home, artifact, running, children }: Props) {
  return (
    <div className="canvas" data-testid="canvas">
      {home && !artifact ? (
        <div className="homeState">
          <h1>Codex</h1>
          <p>Command + Canvas. One shot by default.</p>
        </div>
      ) : artifact ? (
        artifact.content ? (
          <pre className="artifact" aria-label="Artifact">
{artifact.content}
          </pre>
        ) : running ? (
          <div className="runningState" aria-label="Running">
            <div className="runningInner">
              <span className="spinner" aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600 }}>Running…</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>Waiting for output</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="placeholder">No output yet</div>
        )
      ) : (
        <div className="placeholder">No artifact yet</div>
      )}
      {children}
    </div>
  );
}
