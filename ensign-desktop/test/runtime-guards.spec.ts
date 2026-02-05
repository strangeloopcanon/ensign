import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'node:path';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

type LaunchOptions = {
  userDataDir: string;
  stubDelayMs?: number;
};

function launchApp(cwd: string, opts: LaunchOptions): Promise<ElectronApplication> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    ENSIGN_DESKTOP_FORCE_STUB: '1',
    ENSIGN_DESKTOP_USER_DATA: opts.userDataDir,
  };
  if (typeof opts.stubDelayMs === 'number') {
    env.ENSIGN_DESKTOP_STUB_DELAY_MS = String(opts.stubDelayMs);
  }
  return electron.launch({ args: ['.'], cwd, env });
}

test.describe('Runtime guards', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string | null = null;
  const tempDirs: string[] = [];
  const cwd = path.resolve(__dirname, '..');

  test.beforeAll(async () => {
    childProcess.execSync('npm run build:main', { cwd, stdio: 'inherit' });
    childProcess.execSync('npm run build:renderer', { cwd, stdio: 'inherit' });
  });

  test.afterEach(async () => {
    if (app) await app.close();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    userDataDir = null;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('enforces required plan approvals in main and applies step-out overrides', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-workspace-'));
    const extraWriteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-extra-write-'));
    tempDirs.push(workspaceDir, extraWriteDir);
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-desktop-test-'));
    app = await launchApp(cwd, { userDataDir });
    page = await app.firstWindow();

    const result = await page.evaluate(async ({ workspaceDir, extraWriteDir }) => {
      const update = await window.codex.updateSettings({
        workspaceDir,
        sandboxMode: 'workspace-write',
        allowOutsideWorkspaceRead: true,
        additionalWritableRoots: [workspaceDir, extraWriteDir],
      });
      if (!update.ok) {
        return { ok: false, error: update.error || 'failed to update settings' };
      }

      const planRes = await window.codex.plan({
        prompt: 'Organize folder',
        cwd: workspaceDir,
        sandboxMode: 'workspace-write',
      });
      if (!planRes.ok || !planRes.plan) {
        return { ok: false, error: planRes.error || 'failed to build plan' };
      }

      const requiredPermissionIds = planRes.plan.permissions.filter((p) => p.required).map((p) => p.id);

      const denied = await window.codex.taskEnqueue({
        userPrompt: 'Organize folder',
        effectivePrompt: 'Organize folder',
        cwd: workspaceDir,
        sandboxMode: 'workspace-write',
        plan: planRes.plan,
        approvedPermissionIds: [],
      });

      const allowed = await window.codex.taskEnqueue({
        userPrompt: 'Organize folder',
        effectivePrompt: 'Organize folder',
        cwd: workspaceDir,
        sandboxMode: 'workspace-write',
        plan: planRes.plan,
        approvedPermissionIds: requiredPermissionIds,
      });

      const taskList = await window.codex.taskList();
      const tasks = taskList.ok && Array.isArray(taskList.tasks) ? taskList.tasks : [];
      const created = tasks.find((task: any) => task.id === allowed.taskId) || null;

      return {
        ok: true,
        denied,
        allowed,
        plan: planRes.plan,
        configOverrides: created?.configOverrides ?? [],
      };
    }, { workspaceDir, extraWriteDir });

    expect(result.ok).toBeTruthy();
    expect(result.denied.ok).toBeFalsy();
    expect(result.denied.error || '').toContain('Missing required permission approvals');
    expect(result.allowed.ok).toBeTruthy();
    expect(result.plan.permissions.some((p) => p.id === 'extra-write' && p.required)).toBeTruthy();
    expect(result.plan.permissions.some((p) => p.id === 'full-disk-read' && p.required)).toBeTruthy();
    expect(result.plan.sources).toContain(extraWriteDir);

    const writableRootsOverride = result.configOverrides.find((o: string) =>
      o.includes('sandbox_workspace_write.writable_roots=')
    );
    expect(writableRootsOverride).toBeTruthy();
    const writableRoots = JSON.parse(String(writableRootsOverride).split('=').slice(1).join('='));
    expect(Array.isArray(writableRoots)).toBeTruthy();
    expect(writableRoots).toContain(extraWriteDir);
    expect(writableRoots).not.toContain(workspaceDir);

    const fullDiskReadOverride = result.configOverrides.find((o: string) =>
      o.includes('sandbox_permissions=["disk-full-read-access"]')
    );
    expect(fullDiskReadOverride).toBeTruthy();
  });

  test('falls back to default workspace when settings file is invalid JSON', async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-desktop-test-'));
    const settingsPath = path.join(userDataDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{ invalid json', 'utf8');

    app = await launchApp(cwd, { userDataDir });
    page = await app.firstWindow();

    const result = await page.evaluate(async () => {
      return window.codex.getSettings();
    });

    expect(result.ok).toBeTruthy();
    expect(result.settings?.workspaceDir).toBeTruthy();
  });

  test('respects configured task concurrency for background queueing', async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-desktop-test-'));
    app = await launchApp(cwd, { userDataDir, stubDelayMs: 300 });
    page = await app.firstWindow();

    const result = await page.evaluate(async () => {
      await window.codex.updateSettings({ taskConcurrency: 1 });

      const enqueue = async (label: string) =>
        window.codex.taskEnqueue({
          userPrompt: label,
          effectivePrompt: label,
          sandboxMode: 'read-only',
          approvedPermissionIds: [],
        });

      const first = await enqueue('first');
      const second = await enqueue('second');
      const third = await enqueue('third');

      const taskList = await window.codex.taskList();
      const tasks = taskList.ok && Array.isArray(taskList.tasks) ? taskList.tasks : [];
      const runningCount = tasks.filter((task: any) => task.status === 'running').length;
      const queuedCount = tasks.filter((task: any) => task.status === 'queued').length;

      const resumeError = first.taskId
        ? await window.codex.taskResume({ taskId: first.taskId, prompt: 'continue' })
        : { ok: false, error: 'missing task id' };

      return { first, second, third, runningCount, queuedCount, resumeError };
    });

    expect(result.first.ok).toBeTruthy();
    expect(result.second.ok).toBeTruthy();
    expect(result.third.ok).toBeTruthy();
    expect(result.runningCount).toBeGreaterThanOrEqual(1);
    expect(result.queuedCount).toBeGreaterThanOrEqual(1);
    expect(result.resumeError.ok).toBeFalsy();
  });
});
