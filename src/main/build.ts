// The build step (#345 fills this in). The flow calls runBuild once the user has
// confirmed the estimate and the project folder is a fresh git repo.

import type { Estimate } from './estimate';
import type { RunOptions, RunResult } from './runner';
import type { Settings } from './settings';

export interface BuildJob {
  /** What the user typed. */
  request: string;
  estimate: Estimate;
  /** The new project folder: empty apart from .git, with one empty commit. */
  folder: string;
  /** Settings as they were when the user pressed "Build it" (cap, skip permissions, CLI path). */
  settings: Settings;
}

export interface BuildContext {
  log(kind: LogEntry['kind'], text: string): void;
  setStatus(text: string): void;
  /** main.ts's startRun: the CLI with its output streamed to the log, stoppable with Stop. */
  startRun(opts: Omit<RunOptions, 'onStdout' | 'onStderr'>): Promise<RunResult>;
}

/** Builds job.request in job.folder. Resolves when the build has ended. */
export async function runBuild(job: BuildJob, ctx: BuildContext): Promise<void> {
  // #345: run Claude Code here (cap: job.settings.buildCapMinutes, skip permissions:
  // job.settings.skipPermissions).
  ctx.log('info', `Building in ${job.folder} is not wired up yet (#345).`);
}
