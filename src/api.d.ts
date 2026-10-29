// The API the preload script exposes to the renderer as window.api.
// A global declaration file, so the renderer can stay a plain script (no imports).

type Settings = import('./main/settings').Settings;

interface LogEntry {
  kind: 'info' | 'error' | 'stdout' | 'stderr';
  text: string;
}

interface Software2Api {
  getSettings(): Promise<Settings>;
  saveSettings(change: Partial<Settings>): Promise<Settings>;
  detectClaude(): Promise<string | null>;
  pickClaude(): Promise<string | null>;
  pickFolder(current: string): Promise<string | null>;
  go(request: string): Promise<void>;
  stop(): Promise<void>;
  onLog(listener: (entry: LogEntry) => void): void;
  onStatus(listener: (status: string) => void): void;
}

interface Window {
  api: Software2Api;
}
