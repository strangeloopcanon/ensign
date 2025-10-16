import React from 'react';

type Artifact = {
  kind: 'text';
  name?: string;
  content: string;
};

type Props = {
  home: boolean;
  artifact?: Artifact | null;
  children?: React.ReactNode; // for overlays like diffs later
};

export function Canvas({ home, artifact, children }: Props) {
  return (
    <div className="canvas" data-testid="canvas">
      {home && !artifact ? (
        <div className="homeState">
          <h1>Codex</h1>
          <p>Command + Canvas. One shot by default.</p>
        </div>
      ) : artifact ? (
        <pre className="artifact" aria-label="Artifact">
{artifact.content}
        </pre>
      ) : (
        <div className="placeholder">No artifact yet</div>
      )}
      {children}
    </div>
  );
}

