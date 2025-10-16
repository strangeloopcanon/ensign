import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'node:path';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

test.describe('Diff preview', () => {
  let app: ElectronApplication;
  let page: Page;
  const cwd = path.resolve(__dirname, '..');

  test.beforeAll(async () => {
    childProcess.execSync('npm run build:main', { cwd, stdio: 'inherit' });
    childProcess.execSync('npm run build:renderer', { cwd, stdio: 'inherit' });
  });

  test.afterEach(async () => {
    if (app) await app.close();
  });

  test('shows diff when source file provided', async () => {
    const tmp = path.join(os.tmpdir(), `codex-diff-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'Original line');

    try {
      app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, NODE_ENV: 'production' } });
      page = await app.firstWindow();

      await page.getByLabel('Command').fill('Improve this text');
      await page.evaluate((filePath) => window.codex.debugEmitFiles?.([filePath]), tmp);

      await page.getByText('Run').first().click();
      await page.getByTestId('permission-read-files').check();
      await page.getByTestId('permission-network').check();
      await page.getByRole('button', { name: 'Accept' }).click();

      await expect(page.getByLabel('Diff')).toBeVisible();
      await expect(page.getByLabel('Diff')).toContainText('Original line');
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
});
