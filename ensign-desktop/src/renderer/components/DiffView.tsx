import React from 'react';

// Very small unified diff for text -> text transformations.
// Uses a simple LCS-based line diff to keep bundle small.

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function diffLines(oldStr: string, newStr: string): { type: 'ctx'|'add'|'del'; line: string }[] {
  const a = oldStr.split(/\r?\n/);
  const b = newStr.split(/\r?\n/);
  const dp = lcs(a, b);
  const out: { type: 'ctx'|'add'|'del'; line: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', line: a[i++] }); j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', line: a[i++] }); }
    else { out.push({ type: 'add', line: b[j++] }); }
  }
  while (i < a.length) out.push({ type: 'del', line: a[i++] });
  while (j < b.length) out.push({ type: 'add', line: b[j++] });
  return out;
}

export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const diff = diffLines(oldText, newText);
  return (
    <div className="diffView" aria-label="Diff">
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre-wrap' }}>
        {diff.map((d, idx) => (
          <div key={idx} style={{ color: d.type === 'add' ? '#2e8b57' : d.type === 'del' ? '#b00020' : 'inherit' }}>
            {(d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  ') + d.line}
          </div>
        ))}
      </div>
    </div>
  );
}

