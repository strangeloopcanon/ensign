import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'node:path';
import childProcess from 'node:child_process';
import fs from 'node:fs';

test.describe('Save / Undo / Redo', () => {
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

  test('saves artifact, undo removes it, redo restores it', async () => {
    app = await electron.launch({ args: ['.'], cwd, env: { ...process.env, NODE_ENV: 'production' } });
    page = await app.firstWindow();

    await page.getByLabel('Command').fill('make a short note');
    await page.getByText('Run').first().click();
    await page.getByTestId('permission-network').check();
    await page.getByRole('button', { name: 'Accept' }).click();

    // Save artifact
    const res = await page.evaluate(() => window.codex.saveArtifact({ name: 'test-artifact', kind: 'text', content: 'hello' }));
    expect(res.ok).toBeTruthy();
    const p = (res as any).path as string;
    expect(!!p).toBeTruthy();
    expect(fs.existsSync(p)).toBeTruthy();

    // Undo
    const u = await page.evaluate(() => window.codex.undo());
    expect(u.ok).toBeTruthy();
    expect(fs.existsSync(p)).toBeFalsy();

    // Redo
    const r = await page.evaluate(() => window.codex.redo());
    expect(r.ok).toBeTruthy();
    expect(fs.existsSync(p)).toBeTruthy();
  });
});
