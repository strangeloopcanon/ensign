// Thin wrapper around Codex SDK; falls back to a stub if SDK not available.
import path from 'node:path';
import process from 'node:process';

export type RunOptions = { prompt: string; cwd?: string };

// dynamic import to avoid hard crash if module missing
let sdk: any | null = null;
let codexClient: any | null = null;

async function ensureClient() {
  if (codexClient) return codexClient;
  if (!sdk) {
    try {
      sdk = await import('@openai/codex-sdk');
    } catch (e) {
      sdk = null;
    }
  }
  if (sdk?.Codex) {
    // Construct client; honor OPENAI_API_KEY from env if present
    codexClient = new sdk.Codex({ apiKey: process.env.OPENAI_API_KEY });
    return codexClient;
  }
  return null;
}

export type StreamHandler = (chunk: string) => void;

export async function runTask(opts: RunOptions, onData?: StreamHandler): Promise<string> {
  const client = await ensureClient();
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  if (!client) {
    // Stub fallback: simulate streaming
    const text = `Stub run in ${cwd}: ` + opts.prompt.slice(0, 120);
    if (onData) onData(text + '\n');
    return text;
  }
  // Real SDK path
  const thread = await client.startThread({ cwd });
  // Prefer streaming if SDK supports it
  if (typeof thread.runStream === 'function') {
    let final = '';
    for await (const ev of thread.runStream(opts.prompt)) {
      const t = ev?.text ?? '';
      final += t;
      if (t && onData) onData(t);
    }
    return final;
  } else {
    const result = await thread.run(opts.prompt);
    if (onData && result?.text) onData(result.text);
    return result?.text ?? '';
  }
}
