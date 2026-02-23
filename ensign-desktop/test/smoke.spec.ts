import { test, expect } from '@playwright/test';
import childProcess from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { _electron as electron } from 'playwright';

// This is a lightweight smoke: builds renderer and compiles main, then starts Electron in dev mode.
// It asserts the process starts and exits cleanly after a timeout (placeholder until full UI automation wired).

test('electron boots in prod and opens a window', async () => {
  test.setTimeout(60_000);
  const cwd = path.resolve(__dirname, '..');
  // prebuild main and renderer
  childProcess.execSync('npm run build:main', { cwd, stdio: 'inherit' });
  childProcess.execSync('npm run build:renderer', { cwd, stdio: 'inherit' });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensign-desktop-test-'));
  const app = await electron.launch({
    args: ['.'],
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ENSIGN_DESKTOP_USER_DATA: userDataDir,
    },
  });
  const win = await app.firstWindow();
  await expect(win).toBeDefined();
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});
