// Electron main process: one window, settings and the Go/Stop plumbing.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { runBuild } from './build';
import { Flow } from './flow';
import { runClaude, type RunHandle, type RunOptions, type RunResult } from './runner';
import { findOnPath, loadSettings, saveSettings, type Settings } from './settings';

let win: BrowserWindow | null = null;
let currentRun: RunHandle | null = null;

const settingsDir = () => app.getPath('userData');

function log(kind: LogEntry['kind'], text: string): void {
  win?.webContents.send('log', { kind, text } satisfies LogEntry);
}

function setStatus(status: string): void {
  win?.webContents.send('status', status);
}

/** Runs the CLI with its output streamed into the window's log. Only one run at a
 *  time. The build step (#345) goes through here; the estimate runs from flow.ts. */
export function startRun(opts: Omit<RunOptions, 'onStdout' | 'onStderr'>): Promise<RunResult> {
  if (currentRun) return Promise.reject(new Error('Something is already running.'));
  const run = runClaude({
    ...opts,
    onStdout: (line) => log('stdout', line),
    onStderr: (line) => log('stderr', line),
  });
  currentRun = run;
  return run.done.finally(() => {
    if (currentRun === run) currentRun = null;
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 600,
    minHeight: 480,
    title: 'software2',
    backgroundColor: '#f6f6f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
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

ipcMain.handle('dialog:pickFolder', async (_e, current: string) => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Choose a folder',
    defaultPath: current || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

const flow = new Flow({
  settings: () => loadSettings(settingsDir()),
  log,
  setStatus,
  pickFolder: async (defaultPath) => {
    try {
      mkdirSync(defaultPath, { recursive: true });
    } catch {
      // The dialog then opens wherever Windows likes.
    }
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pick or create a new, empty folder for the project',
      defaultPath,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return res.canceled ? null : res.filePaths[0];
  },
  refuseFolder: async (message) => {
    await dialog.showMessageBox(win!, {
      type: 'warning',
      title: 'Choose another folder',
      message: 'This folder cannot be used for a new project',
      detail: message,
      buttons: ['Pick again'],
    });
  },
  build: (job) => runBuild(job, { log, setStatus, startRun }),
});

ipcMain.handle('app:estimate', (_e, request: string) => flow.estimate(String(request ?? '')));
ipcMain.handle('app:confirm', () => flow.confirm());
ipcMain.handle('app:cancel', () => flow.cancel());

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
  app.quit();
});
