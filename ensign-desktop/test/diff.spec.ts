import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'node:path';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

test.describe('Diff preview', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string | null = null;
  const cwd = path.resolve(__dirname, '..');

  test.beforeAll(async () => {
    childProcess.execSync('npm run build:main', { cwd, stdio: 'inherit' });
    childProcess.execSync('npm run build:renderer', { cwd, stdio: 'inherit' });
  });

  test.afterEach(async () => {
    if (app) await app.close();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    userDataDir = null;
  });

  test('shows diff when source file provided', async () => {
    const tmp = path.join(os.tmpdir(), `codex-diff-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'Original line');

    try {
      userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-desktop-test-'));
      app = await electron.launch({
        args: ['.'],
        cwd,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ENSIGN_DESKTOP_FORCE_STUB: '1',
          ENSIGN_DESKTOP_USER_DATA: userDataDir,
        },
      });
      page = await app.firstWindow();

      await page.evaluate(async (workspaceDir) => {
        await window.codex.updateSettings({ workspaceDir });
      }, path.dirname(tmp));

      await page.getByLabel('Command').fill('Improve this text');
      await page.evaluate((filePath) => window.codex.debugEmitFiles?.([filePath]), tmp);

      await page.getByRole('button', { name: 'Generate plan' }).click();
      const planDialog = page.getByRole('dialog', { name: 'Execution plan' });
      await expect(planDialog).toBeVisible();
      const perms = planDialog.locator('input[type="checkbox"][data-testid^="permission-"]');
      for (let i = 0, n = await perms.count(); i < n; i++) {
        await perms.nth(i).check();
      }
      await planDialog.getByRole('button', { name: 'Run' }).click();

      await expect(page.getByLabel('Diff')).toBeVisible();
      await expect(page.getByLabel('Diff')).toContainText('Original line');
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
});
