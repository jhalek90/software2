// Demo mode, off by default, for trying the look and taking screenshots without Claude.
//   SOFTWARE2_DEMO=1        run against test/fake-claude.mjs with a throwaway data folder,
//                           %TEMP%\software2-demo-* (never the real settings);
//                           the folder dialog is skipped and a fresh empty folder is used.
//   SOFTWARE2_SHOTS=<dir>   demo mode, plus: walk through every state in light and dark
//                           (with the Advanced panel set and a few sample files added),
//                           save a PNG of each into <dir> (and reduced-motion ones), write
//                           the idle CPU use to <dir>\cpu-idle.txt, then quit.
//   SOFTWARE2_THEME=light|dark   force a theme (otherwise Windows' setting).
// The fake CLI's FAKE_CLAUDE_DELAY_MS defaults to 1500 here, so each state stays up long
// enough to see, and FAKE_CLAUDE_RUN to static (a page to open). Run now never runs a
// command in demo mode (main.ts).

import { app, nativeTheme, type BrowserWindow, type ProcessMetric } from 'electron';
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
  // A build that leaves a RUN.json for a page to open, so the card has "How to run it".
  process.env.FAKE_CLAUDE_RUN ??= 'static';
  // Shots mode measures idle CPU with the background running, even if other windows
  // cover this one (Chromium would otherwise count it as hidden and pause it).
  if (shotsDir) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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

/** A few made-up files for the Advanced panel in shots mode (the app never opens them). */
function sampleFiles(): string[] {
  const dir = path.join(root, 'samples');
  mkdirSync(dir, { recursive: true });
  const files: [string, number][] = [
    ['my-cat-on-the-sofa.jpg', 2_400_000],
    ['my-cat-sleeping.jpg', 1_700_000],
    ['logo.svg', 6_200],
  ];
  return files.map(([name, size]) => {
    const p = path.join(dir, name);
    writeFileSync(p, Buffer.alloc(size));
    return p;
  });
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
  // Page errors and warnings show up in the terminal, so a broken state is not missed.
  wc.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') console.error(`Page ${e.level}: ${e.message}`);
  });
  const escape = () => {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  };

  const samples = sampleFiles();
  // The Advanced panel, opened and filled in the way a person would.
  const fillAdvanced = async () => {
    await click('#adv-toggle');
    await js(`advTime.value = '45'; advStyle.value = 'dark and minimal'; renderAdvanced()`);
    await js(`window.api.inspectFiles(${JSON.stringify(samples)}).then(addFiles)`);
  };

  try {
    for (const theme of ['light', 'dark'] as const) {
      nativeTheme.themeSource = theme;
      wc.reload();
      await new Promise<void>((r) => wc.once('did-finish-load', () => r()));
      await sleep(300);
      await shot('empty');

      await fillAdvanced();
      await js(`document.getElementById('request').value = 'a website about my cat, with a photo gallery'`);
      await shot('advanced');
      await click('#adv-toggle'); // closed again: the chip still says what is set
      await shot('advanced-closed');
      await click('#go');
      await sleep(500);
      await shot('estimating');

      await until(`document.getElementById('confirm-dialog').open`);
      await shot('confirm');

      await click('#confirm-dialog button[value="build"]');
      // The box (and Advanced with it) is away for the whole build.
      await until(`document.getElementById('request-form').hidden && !document.getElementById('building').hidden`);
      await sleep(7000);
      await shot('building');
      // The same build as if it had run past its estimate (only the clock is moved back).
      await js(`buildClock.startedAt -= 3 * 60_000; tick()`);
      await shot('building-over');

      await until(`!document.getElementById('result').hidden`);
      await shot('done');

      await click('#settings-open');
      await shot('settings');
      escape(); // Escape closes Settings
      await until(`!document.getElementById('settings-dialog').open`, 2000);

      // A build that fails: the result card with its "Open full log" link. Escape on the
      // confirm card cancels it first.
      // "Build something else": the box is back, empty, with Advanced at its defaults.
      await click('#result-close');
      await until(
        `!document.getElementById('request-form').hidden && document.getElementById('building').hidden && !document.getElementById('request').value && document.getElementById('adv-chip').hidden`,
        2000,
      );
      await shot('again');

      // "How to run it" for an app started by a command, its Run now confirm (cancelled:
      // nothing runs), and a build with only the README's "How to run" section.
      const quick = async (run: string, what: string) => {
        process.env.FAKE_CLAUDE_RUN = run;
        process.env.FAKE_CLAUDE_DELAY_MS = '100';
        await js(`document.getElementById('request').value = ${JSON.stringify(what)}`);
        await click('#go');
        await until(`document.getElementById('confirm-dialog').open`);
        await click('#confirm-dialog button[value="build"]');
        await until(`!document.getElementById('result').hidden`);
        await sleep(800);
      };
      await quick('command', 'a block-building game for the browser');
      await shot('done-command');
      await click('#run-now');
      await until(`document.getElementById('run-dialog').open`);
      await shot('run-confirm');
      escape();
      await until(`!document.getElementById('run-dialog').open`, 2000);
      await click('#result-close');
      await quick('readme', 'a markdown previewer');
      await shot('done-readme');
      process.env.FAKE_CLAUDE_RUN = 'static';
      process.env.FAKE_CLAUDE_DELAY_MS = '1500';
      await click('#result-close');
      await until(`!document.getElementById('request-form').hidden`, 2000);
      await js(`document.getElementById('request').value = 'a CSV to JSON converter for the command line'`);
      await click('#go');
      await until(`document.getElementById('confirm-dialog').open`);
      escape();
      await until(`!document.getElementById('confirm-dialog').open && document.getElementById('status').hidden`, 2000);
      await click('#go');
      await until(`document.getElementById('confirm-dialog').open`);
      process.env.FAKE_CLAUDE_MODE = 'fail'; // only the build fails, not the estimate
      await click('#confirm-dialog button[value="build"]');
      await until(`!document.getElementById('result').hidden`);
      delete process.env.FAKE_CLAUDE_MODE;
      await sleep(1200); // the background's muted red eases in
      await shot('failed');

      // The smallest window: the disclaimer wraps and stays clear of the card.
      const [width, height] = win.getSize();
      win.setSize(600, 480);
      await shot('narrow-failed');
      await click('#result-close');
      await shot('narrow-empty');
      await fillAdvanced();
      await shot('narrow-advanced');
      await js('resetAdvanced()');
      win.setSize(width, height);

      // prefers-reduced-motion: a still background.
      wc.debugger.attach();
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await shot('reduced-empty');
      wc.debugger.detach();
    }
    await measureIdleCpu(win);
  } catch (err) {
    console.error(`Screenshots failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
  app.quit();
}

/** Idle CPU use of every app process over 10 s, with the window shown and minimised. */
async function measureIdleCpu(win: BrowserWindow): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const frames = () => win.webContents.executeJavaScript('backdrop.framesDrawn') as Promise<number>;
  // CPU seconds per process from cumulativeCPUUsage, over 10 s: 100% is one core busy.
  const cpuSeconds = () => new Map(app.getAppMetrics().map((m: ProcessMetric) => [m.pid, { type: m.type, s: m.cpu.cumulativeCPUUsage ?? 0 }]));
  const sample = async () => {
    const before = cpuSeconds();
    const framesBefore = await frames();
    await sleep(10_000);
    const drawn = (await frames()) - framesBefore;
    const parts: string[] = [];
    let total = 0;
    for (const [pid, after] of cpuSeconds()) {
      const pct = ((after.s - (before.get(pid)?.s ?? after.s)) / 10) * 100;
      total += pct;
      parts.push(`${after.type} ${pct.toFixed(1)}%`);
    }
    return `${total.toFixed(1)}% of one core (${parts.join(', ')}); background frames drawn: ${drawn} in 10 s`;
  };
  win.focus();
  await sleep(2000);
  const shown = await sample();
  win.minimize();
  await sleep(1000);
  const minimized = await sample();
  win.restore();
  await sleep(1000);
  win.webContents.debugger.attach();
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const still = await sample();
  win.webContents.debugger.detach();
  writeFileSync(
    path.join(shotsDir!, 'cpu-idle.txt'),
    `Idle, window shown: ${shown}
Idle, minimised: ${minimized}
Idle, reduced motion (still background): ${still}
`,
  );
}
