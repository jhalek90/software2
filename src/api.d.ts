// The API the preload script exposes to the renderer as window.api.
// A global declaration file, so the renderer can stay a plain script (no imports).

type Settings = import('./main/settings').Settings;
type Estimate = import('./main/estimate').Estimate;
type EstimateOutcome = import('./main/estimate').EstimateOutcome;
type ConfirmOutcome = import('./main/flow').ConfirmOutcome;

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
  /** Step 1 of Go. On ok, call confirm() ("Build it") or cancel(). */
  estimate(request: string): Promise<EstimateOutcome>;
  /** Folder dialog, git init, then the build. */
  confirm(): Promise<ConfirmOutcome>;
  cancel(): Promise<void>;
  stop(): Promise<void>;
  onLog(listener: (entry: LogEntry) => void): void;
  onStatus(listener: (status: string) => void): void;
}

interface Window {
  api: Software2Api;
}
