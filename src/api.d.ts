// The API the preload script exposes to the renderer as window.api.
// A global declaration file, so the renderer can stay a plain script (no imports).

type Settings = import('./main/settings').Settings;
type Estimate = import('./main/estimate').Estimate;
type EstimateOutcome = import('./main/estimate').EstimateOutcome;
type ConfirmOutcome = import('./main/flow').ConfirmOutcome;
type BuildOutcome = import('./main/build').BuildOutcome;
type BuildEvent = import('./main/build').BuildEvent;

interface LogEntry {
  /** assistant: Claude's text; tool: a tool call as one line; output: a trimmed tool result. */
  kind: 'info' | 'error' | 'stdout' | 'stderr' | 'assistant' | 'tool' | 'output';
  text: string;
}

interface WindowState {
  maximized: boolean;
  minimized: boolean;
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
  /** The commands Claude may run when the permission-skip setting is off. */
  allowedCommands(): Promise<string[]>;
  /** Open the last build's folder, or its README.md. */
  openFolder(): Promise<void>;
  openReadme(): Promise<void>;
  /** Open the last build's full log file, if it was kept. */
  openLog(): Promise<void>;
  /** Every log line; the full log also goes to a file per run (BuildOutcome.logFile). */
  onLog(listener: (entry: LogEntry) => void): void;
  onStatus(listener: (status: string) => void): void;
  /** What Claude is doing now during a build, one short sentence ("Writing src/app.js"). */
  onActivity(listener: (text: string) => void): void;
  onBuild(listener: (event: BuildEvent) => void): void;
  /** The custom title bar's buttons (the window is frameless). */
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onWindowState(listener: (state: WindowState) => void): void;
}

interface Window {
  api: Software2Api;
}
