import React from 'react';

const templates = [
  'Summarize PDF',
  'Extract tables to CSV',
  'Compare two docs',
  'Draft reply to this email',
  'Turn bullets into slides',
  'Fill this form from my info',
  'Transcribe and chapterize audio',
  'Clean this CSV and explain',
  'Make a schedule from these events',
  'Translate with tone control',
  'Redline this contract',
  'Create a study guide from this chapter',
];

type Props = {
  onPick: (t: string) => void;
};

export function HomeTemplates({ onPick }: Props) {
  return (
    <div className="templates" role="grid" aria-label="Core templates">
      {templates.map((t) => (
        <button key={t} className="templateTile" role="gridcell" onClick={() => onPick(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

