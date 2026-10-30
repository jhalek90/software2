// Electron main process: one window, settings and the Go/Stop plumbing.

import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { inspectFiles, type AdvancedOptions } from './advanced';
import { ALLOWED_COMMANDS, runBuild, type BuildEvent, type BuildOutcome } from './build';
import { DEMO, setupDemo, takeShots } from './demo';
import { Flow } from './flow';
import { RunNow } from './howtorun';
import { RunLog } from './runlog';
import { runClaude, type RunHandle, type RunOptions, type RunResult } from './runner';
import { findOnPath, loadSettings, saveSettings, type Settings } from './settings';

setupDemo();

let win: BrowserWindow | null = null;
let currentRun: RunHandle | null = null;
/** The build in progress, so quitting can wait for it to be stopped and saved. */
let currentBuild: Promise<unknown> | null = null;
/** The full log of the current run (an estimate and its build), one file per Go. */
let runLog: RunLog | null = null;
/** The last build that ended: the result card's buttons open its folder, README and log. */
let lastBuild: BuildOutcome | null = null;

const settingsDir = () => app.getPath('userData');

/** Everything goes to the run's log file; the window only shows errors (see the renderer). */
function log(kind: LogEntry['kind'], text: string): void {
  runLog?.write(kind, text);
  win?.webContents.send('log', { kind, text } satisfies LogEntry);
}

function setActivity(text: string): void {
  win?.webContents.send('activity', text);
}

function setStatus(status: string): void {
  win?.webContents.send('status', status);
}

function sendBuild(event: BuildEvent): void {
  lastBuild = event.type === 'ended' ? event.outcome : null;
  win?.webContents.send('build', event);
}

/** Runs the CLI so Stop can kill it; output goes to the log unless the caller handles
 *  it. Only one run at a time. The build goes through here; the estimate runs from flow.ts. */
export function startRun(opts: RunOptions): Promise<RunResult> {
  if (currentRun) return Promise.reject(new Error('Something is already running.'));
  const run = runClaude({
    onStdout: (line) => log('stdout', line),
    onStderr: (line) => log('stderr', line),
    ...opts,
  });
  currentRun = run;
  return run.done.finally(() => {
    if (currentRun === run) currentRun = null;
  });
}

/** Tells the page whether the window is maximised (for the title bar's button) and
 *  minimised (the animated background pauses then). */
function sendWindowState(): void {
  if (!win) return;
  win.webContents.send('window-state', { maximized: win.isMaximized(), minimized: win.isMinimized() } satisfies WindowState);
}

function createWindow(): void {
  // Frameless: the page draws its own slim title bar (see index.html). Windows keeps the
  // resize borders, snap and Win+arrow keys since the window stays resizable.
  win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 600,
    minHeight: 480,
    title: 'software(2);',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151b' : '#eef1f6',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (DEMO) win.setTitle('software(2); (demo: fake Claude)');
  win.webContents.once('did-finish-load', () => {
    if (win) takeShots(win);
  });
  win.webContents.on('did-finish-load', sendWindowState);
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);
  win.on('minimize', sendWindowState);
  win.on('restore', sendWindowState);
  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('settings:get', () => loadSettings(settingsDir()));
ipcMain.handle('settings:save', (_e, change: Partial<Settings>) => saveSettings(settingsDir(), change));
ipcMain.handle('settings:detectClaude', () => findOnPath('claude'));

ipcMain.handle('dialog:pickClaude', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Find the claude CLI',
    properties: ['openFile'],
    filters: [
      { name: 'Programs', extensions: ['exe', 'cmd', 'bat', 'js', 'mjs'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePaths[0];
});

// Settings' Browse for the projects folder (projects themselves are never picked: flow.ts
// names and makes their folders).
ipcMain.handle('dialog:pickFolder', async (_e, current: string) => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Choose a folder',
    defaultPath: current || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// The Advanced panel's files: only looked at (size, file or folder) and, at build time,
// copied into the project's assets/. Never opened or sent anywhere.
ipcMain.handle('files:pick', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Add files for the project',
    properties: ['openFile', 'multiSelections'],
  });
  return inspectFiles(res.canceled ? [] : res.filePaths);
});
ipcMain.handle('files:inspect', (_e, paths: string[]) => inspectFiles(Array.isArray(paths) ? paths.map(String) : []));

const flow = new Flow({
  settings: () => loadSettings(settingsDir()),
  log,
  setStatus,
  build: async (job) => {
    const build = runBuild(job, {
      log,
      setStatus,
      startRun,
      onEvent: sendBuild,
      onActivity: setActivity,
      logFile: runLog?.file,
    });
    currentBuild = build;
    try {
      await build;
    } finally {
      currentBuild = null;
    }
  },
});

ipcMain.handle('app:estimate', (_e, request: string, options?: AdvancedOptions) => {
  const text = String(request ?? '');
  if (text.trim() && !flow.busy) {
    try {
      runLog = new RunLog(settingsDir());
    } catch {
      runLog = null; // No log file then; the run itself still works.
    }
  }
  return flow.estimate(text, options);
});
ipcMain.handle('app:confirm', () => flow.confirm());
ipcMain.handle('app:cancel', () => flow.cancel());

ipcMain.handle('window:control', (_e, action: string) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === 'close') win.close();
});

ipcMain.handle('app:allowedCommands', () => ALLOWED_COMMANDS);

// Only the last build's folder, README and log can be opened, never a path the page makes up.
const openPath = async (target: string) => {
  const error = await shell.openPath(target);
  if (error) log('error', `Could not open ${target}: ${error}`);
};
ipcMain.handle('build:openFolder', async () => {
  if (lastBuild) await openPath(lastBuild.folder);
});
ipcMain.handle('build:openReadme', async () => {
  if (lastBuild) await openPath(path.join(lastBuild.folder, 'README.md'));
});
ipcMain.handle('build:openLog', async () => {
  if (!lastBuild?.logFile) return;
  if (existsSync(lastBuild.logFile)) await openPath(lastBuild.logFile);
  else log('error', 'That log file has been deleted (only the last 100 runs are kept).');
});

// Run now: only what the last build's RUN.json says, in a visible terminal window or the
// browser. Commands are shown to the person (status 'confirm') before they first run.
const runNow = new RunNow({
  openFile: (file) => shell.openPath(file),
  // A .cmd opened through the shell runs in a new console window of its own: visible, and
  // closing it stops the app. Nothing is run hidden. Demo mode never runs anything.
  openTerminal: async (script) => (DEMO ? 'demo mode does not run commands' : shell.openPath(script)),
  openUrl: (url) => (DEMO ? Promise.resolve() : shell.openExternal(url)),
  note: (text) => win?.webContents.send('run-note', text),
  scriptDir: path.join(settingsDir(), 'run'),
});
ipcMain.handle('build:runNow', async (_e, confirmed?: boolean) => {
  const how = lastBuild?.howToRun;
  if (!lastBuild || how?.source !== 'run.json') return { status: 'error', message: 'There is no RUN.json to run.' };
  return runNow.run(how.spec, lastBuild.folder, path.basename(lastBuild.folder), confirmed === true);
});
ipcMain.handle('app:copy', (_e, text: unknown) => {
  if (typeof text === 'string' && text.length <= 10_000) clipboard.writeText(text);
});

ipcMain.handle('app:stop', () => {
  flow.stop();
  if (currentRun) {
    currentRun.stop();
    log('info', 'Stopping...');
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  flow.stop();
  currentRun?.stop();
  if (!currentBuild) {
    app.quit();
    return;
  }
  // Let the stopped build finish ending first (bounded, in case it hangs).
  const giveUp = new Promise((resolve) => setTimeout(resolve, 10_000));
  Promise.race([currentBuild.catch(() => {}), giveUp]).then(() => app.quit());
});
