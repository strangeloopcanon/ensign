import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'node:path';
import childProcess from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';

test.describe('Command + Canvas UI', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string | null = null;
  const cwd = path.resolve(__dirname, '..');

  test.beforeAll(async () => {
    // Build once for all tests
    childProcess.execSync('npm run build:main', { cwd, stdio: 'inherit' });
    childProcess.execSync('npm run build:renderer', { cwd, stdio: 'inherit' });
  });

  test.afterEach(async () => {
    if (app) await app.close();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    userDataDir = null;
  });

  test('renders layout and runs plan -> accept flow', async () => {
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

    // Layout elements
    await expect(page.getByTestId('command-bar')).toBeVisible();
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.getByTestId('action-bar')).toBeVisible();

    // Enter a command, preview plan, then run
    await page.getByLabel('Command').fill('Summarize PDF');
    await page.getByRole('button', { name: 'Generate plan' }).click();

    const planDialog = page.getByRole('dialog', { name: 'Execution plan' });
    await expect(planDialog).toBeVisible();
    await expect(planDialog.getByText('Steps')).toBeVisible();
    // Grant any surfaced permissions (may be none in stub mode).
    const perms = planDialog.locator('input[type="checkbox"][data-testid^="permission-"]');
    for (let i = 0, n = await perms.count(); i < n; i++) {
      await perms.nth(i).check();
    }

    const runButton = planDialog.getByRole('button', { name: 'Run' });
    await expect(runButton).toBeEnabled();
    await runButton.click();

    // Should get stubbed artifact
    await expect(page.getByLabel('Artifact')).toBeVisible();
    await expect(page.getByLabel('Artifact')).toContainText('Stub run');
  });
});
