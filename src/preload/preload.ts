// Exposes a small, fixed API to the renderer. The renderer never gets Node or ipcRenderer.

import { contextBridge, ipcRenderer } from 'electron';

const api: Software2Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (change) => ipcRenderer.invoke('settings:save', change),
  detectClaude: () => ipcRenderer.invoke('settings:detectClaude'),
  pickClaude: () => ipcRenderer.invoke('dialog:pickClaude'),
  pickFolder: (current) => ipcRenderer.invoke('dialog:pickFolder', current),
  estimate: (request) => ipcRenderer.invoke('app:estimate', request),
  confirm: () => ipcRenderer.invoke('app:confirm'),
  cancel: () => ipcRenderer.invoke('app:cancel'),
  stop: () => ipcRenderer.invoke('app:stop'),
  allowedCommands: () => ipcRenderer.invoke('app:allowedCommands'),
  getHistory: () => ipcRenderer.invoke('history:list'),
  openFolder: (id) => ipcRenderer.invoke('history:openFolder', id),
  openReadme: (id) => ipcRenderer.invoke('history:openReadme', id),
  onLog: (listener) => {
    ipcRenderer.on('log', (_e, entry: LogEntry) => listener(entry));
  },
  onStatus: (listener) => {
    ipcRenderer.on('status', (_e, status: string) => listener(status));
  },
  onBuild: (listener) => {
    ipcRenderer.on('build', (_e, event: BuildEvent) => listener(event));
  },
};

contextBridge.exposeInMainWorld('api', api);
