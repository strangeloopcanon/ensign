import fs from 'node:fs';
import path from 'node:path';

export type Skill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  dir: string;
  filePath: string;
};

function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const trimmed = md.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) return { meta: {}, body: md };
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3) return { meta: {}, body: md };
  if (lines[0].trim() !== '---') return { meta: {}, body: md };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { meta: {}, body: md };
  const metaLines = lines.slice(1, endIdx);
  const bodyLines = lines.slice(endIdx + 1);
  const meta: Record<string, string> = {};
  for (const line of metaLines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    meta[key] = value.replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: bodyLines.join('\n') };
}

function safeReadText(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    // avoid huge skill files
    if (stat.size > 1024 * 1024) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readSkillFromDir(skillDir: string): Skill | null {
  const filePath = path.join(skillDir, 'SKILL.md');
  const raw = safeReadText(filePath);
  if (!raw) return null;
  const { meta, body } = parseFrontmatter(raw);
  const id = path.basename(skillDir);
  const name = meta.name || id;
  const description = meta.description || meta.summary || '';
  const instructions = body.trim();
  return { id, name, description, instructions, dir: skillDir, filePath };
}

export function listWorkspaceSkills(workspaceDir: string): Skill[] {
  const root = path.join(workspaceDir, '.ensign', 'skills');
  try {
    if (!fs.existsSync(root)) return [];
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return [];
    const dirs = fs
      .readdirSync(root)
      .map((name) => path.join(root, name))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
    const skills: Skill[] = [];
    for (const d of dirs) {
      const skill = readSkillFromDir(d);
      if (skill) skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

