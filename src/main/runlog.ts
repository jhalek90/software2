// The full log of one run (the estimate and the build after it) as a plain text file in
// the app's own folder, so a build can still be debugged now that the window shows only
// one status line. No Electron imports.

import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const LOGS_DIR = 'logs';
/** Older log files are deleted when a new run starts. */
export const LOGS_MAX = 100;

export class RunLog {
  readonly file: string;

  /** dir: the app's userData folder; the file goes into its logs folder. */
  constructor(dir: string, now = new Date()) {
    const logs = path.join(dir, LOGS_DIR);
    mkdirSync(logs, { recursive: true });
    pruneLogs(logs, LOGS_MAX - 1);
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    this.file = path.join(logs, `run-${stamp}.log`);
    this.write('info', `software2 run started ${now.toString()}`);
  }

  /** One entry per line, "12:03:04 tool    Write src/app.js"; later lines of a long entry indented. */
  write(kind: LogEntry['kind'], text: string): void {
    const time = new Date().toTimeString().slice(0, 8);
    const [first, ...rest] = text.split(/\r?\n/);
    const lines = [`${time} ${kind.padEnd(9)} ${first}`, ...rest.map((l) => `${' '.repeat(19)}${l}`)];
    try {
      appendFileSync(this.file, lines.join('\n') + '\n');
    } catch {
      // A full disk or a locked file must not break the build.
    }
  }
}

/** Keeps the newest `keep` run-*.log files in logs. */
function pruneLogs(logs: string, keep: number): void {
  try {
    const files = readdirSync(logs)
      .filter((f) => /^run-.*\.log$/.test(f))
      .sort()
      .reverse();
    for (const f of files.slice(keep)) rmSync(path.join(logs, f), { force: true });
  } catch {
    // Pruning is best effort.
  }
}
