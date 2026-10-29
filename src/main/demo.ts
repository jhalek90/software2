// Demo mode, off by default, for trying the look and taking screenshots without Claude.
//   SOFTWARE2_DEMO=1        run against test/fake-claude.mjs with a throwaway data folder,
//                           %TEMP%\software2-demo-* (never the real settings);
//                           the folder dialog is skipped and a fresh empty folder is used.
//   SOFTWARE2_SHOTS=<dir>   demo mode, plus: walk through every state in light and dark,
//                           save a PNG of each into <dir>, then quit.
//   SOFTWARE2_THEME=light|dark   force a theme (otherwise Windows' setting).
// The fake CLI's FAKE_CLAUDE_DELAY_MS defaults to 1500 here, so each state stays up long
// enough to see.

import { app, nativeTheme, type BrowserWindow } from 'electron';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveSettings } from './settings';

const shotsDir = process.env.SOFTWARE2_SHOTS;
export const DEMO = process.env.SOFTWARE2_DEMO === '1' || !!shotsDir;

const FAKE_CLI = path.join(__dirname, '..', '..', 'test', 'fake-claude.mjs');
let root = '';
let folders = 0;

/** Call before the app is ready. Points userData at a fresh temp folder with demo settings. */
export function setupDemo(): void {
  if (!DEMO) return;
  // Electron still holds files in userData when it quits, so earlier demo folders are
  // removed here instead (best effort: one still in use is skipped).
  for (const old of readdirSync(os.tmpdir()).filter((f) => f.startsWith('software2-demo-'))) {
    try {
      removeTree(path.join(os.tmpdir(), old));
    } catch {
      // In use by another demo window.
    }
  }
  root = mkdtempSync(path.join(os.tmpdir(), 'software2-demo-'));
  const data = path.join(root, 'data');
  app.setPath('userData', data);
  process.env.FAKE_CLAUDE_DELAY_MS ??= '1500';
  const theme = process.env.SOFTWARE2_THEME;
  if (theme === 'light' || theme === 'dark') nativeTheme.themeSource = theme;

  saveSettings(data, { claudePath: FAKE_CLI, projectsFolder: path.join(root, 'projects') });
}

/** rmSync, after making every file writable: git's object files are read-only, and
 *  Electron's rmSync refuses those on Windows. */
function removeTree(dir: string): void {
  const writable = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) writable(p);
      else chmodSync(p, 0o666);
    }
  };
  writable(dir);
  rmSync(dir, { recursive: true, force: true });
}

/** A new, empty folder for the next build, instead of the folder dialog. */
export function demoFolder(): string {
  const dir = path.join(root, 'projects', `demo-${++folders}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** In shots mode: drives the window through each state and saves screenshots, then quits. */
export async function takeShots(win: BrowserWindow): Promise<void> {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const wc = win.webContents;
  const js = <T = unknown>(code: string): Promise<T> => wc.executeJavaScript(code);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (code: string, timeoutMs = 30_000) => {
    const end = Date.now() + timeoutMs;
    while (!(await js<boolean>(code))) {
      if (Date.now() > end) throw new Error(`Timed out waiting for: ${code}`);
      await sleep(100);
    }
  };
  const shot = async (name: string) => {
    await sleep(400); // let transitions finish
    const image = await wc.capturePage();
    writeFileSync(path.join(shotsDir, `${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}-${name}.png`), image.toPNG());
  };
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);

  try {
    for (const theme of ['light', 'dark'] as const) {
      nativeTheme.themeSource = theme;
      wc.reload();
      await new Promise<void>((r) => wc.once('did-finish-load', () => r()));
      await sleep(300);
      await shot('empty');

      await js(`document.getElementById('request').value = 'A to-do list web page that remembers my tasks'`);
      await click('#go');
      await sleep(500);
      await shot('estimating');

      await until(`document.getElementById('confirm-dialog').open`);
      await shot('confirm');

      await click('#confirm-dialog button[value="build"]');
      await sleep(7000);
      await shot('building');
      // The same build as if it had run past its estimate (only the clock is moved back).
      await js(`buildClock.startedAt -= 3 * 60_000; tick()`);
      await shot('building-over');

      await until(`!document.getElementById('result').hidden`);
      await shot('done');

      await click('#settings-open');
      await shot('settings');
      await js(`document.getElementById('settings-dialog').close()`);

      // A build that fails: the result card with its "Open full log" link.
      await click('#result-close');
      await js(`document.getElementById('request').value = 'A CSV to JSON converter for the command line'`);
      await click('#go');
      await until(`document.getElementById('confirm-dialog').open`);
      process.env.FAKE_CLAUDE_MODE = 'fail'; // only the build fails, not the estimate
      await click('#confirm-dialog button[value="build"]');
      await until(`!document.getElementById('result').hidden`);
      delete process.env.FAKE_CLAUDE_MODE;
      await shot('failed');

      // The smallest window: the disclaimer wraps and stays clear of the card.
      const [width, height] = win.getSize();
      win.setSize(600, 480);
      await shot('narrow-failed');
      await click('#result-close');
      await shot('narrow-empty');
      win.setSize(width, height);
    }
  } catch (err) {
    console.error(`Screenshots failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
  app.quit();
}
