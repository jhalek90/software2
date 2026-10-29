// Electron main process: one window, settings and the Go/Stop plumbing.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
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
 *  time. The estimate (#344) and build (#345) steps go through here. */
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

ipcMain.handle('app:go', (_e, request: string) => {
  const text = String(request ?? '').trim();
  if (!text) {
    log('error', 'Type what you want first.');
    return;
  }
  // The estimate and build steps come in the next tasks (#344, #345).
  log('info', `Request: ${text}`);
  log('info', 'Estimating and building are not wired up yet.');
  setStatus('Ready');
});

ipcMain.handle('app:stop', () => {
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
  currentRun?.stop();
  app.quit();
});
