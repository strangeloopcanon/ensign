import React from 'react';

export function PromptBox(props: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      className="textarea"
      placeholder="Enter prompt..."
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      spellCheck={false}
    />
  );
}
