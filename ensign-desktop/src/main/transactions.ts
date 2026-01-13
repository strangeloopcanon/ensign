import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';

export type TxEntry = {
  id: string;
  kind: 'create';
  path: string; // target path created
  backup?: string; // when undone, moved here
  ts: number;
  undone?: boolean;
};

const FOLDER = () => path.join(app.getPath('userData'), 'transactions');
const LOG = () => path.join(FOLDER(), 'log.json');
const TRASH = () => path.join(FOLDER(), 'trash');

function readLog(): TxEntry[] {
  try {
    if (!fs.existsSync(LOG())) return [];
    const raw = fs.readFileSync(LOG(), 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as TxEntry[];
    return [];
  } catch {
    return [];
  }
}

function writeLog(items: TxEntry[]) {
  if (!fs.existsSync(FOLDER())) fs.mkdirSync(FOLDER(), { recursive: true });
  fs.writeFileSync(LOG(), JSON.stringify(items, null, 2));
}

export function history() {
  return readLog();
}

export function recordCreate(targetPath: string) {
  const items = readLog();
  const id = crypto.randomUUID();
  items.push({ id, kind: 'create', path: targetPath, ts: Date.now() });
  writeLog(items);
  return id;
}

export function undo() {
  const items = readLog();
  const last = [...items].reverse().find((e) => !e.undone);
  if (!last) return { ok: false, error: 'Nothing to undo' } as const;
  if (last.kind === 'create') {
    if (!fs.existsSync(TRASH())) fs.mkdirSync(TRASH(), { recursive: true });
    const name = path.basename(last.path);
    let backup = path.join(TRASH(), name);
    let i = 1;
    while (fs.existsSync(backup)) backup = path.join(TRASH(), `${name}.${i++}`);
    try {
      if (fs.existsSync(last.path)) fs.renameSync(last.path, backup);
      last.backup = backup;
      last.undone = true;
      writeLog(items);
      return { ok: true, entry: last } as const;
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) } as const;
    }
  }
  return { ok: false, error: 'Unsupported tx kind' } as const;
}

export function redo() {
  const items = readLog();
  const next = items.find((e) => e.undone);
  if (!next) return { ok: false, error: 'Nothing to redo' } as const;
  if (next.kind === 'create') {
    try {
      if (next.backup && fs.existsSync(next.backup)) {
        // ensure folder exists
        const dir = path.dirname(next.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(next.backup, next.path);
      }
      next.undone = false;
      writeLog(items);
      return { ok: true, entry: next } as const;
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) } as const;
    }
  }
  return { ok: false, error: 'Unsupported tx kind' } as const;
}

