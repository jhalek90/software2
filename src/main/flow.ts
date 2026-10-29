// What happens after Go: estimate -> confirm -> folder -> build. The steps that need
// Electron (dialogs, the window) come in as functions, so the tests run this under Node.

import path from 'node:path';
import { ASSETS_DIR, checkOptions, copyIntoAssets, type AdvancedOptions, type RunExtras } from './advanced';
import type { BuildJob } from './build';
import { startEstimate, type Estimate, type EstimateHandle, type EstimateOutcome } from './estimate';
import { prepareProjectFolder } from './project';
import type { Settings } from './settings';

export interface FlowDeps {
  settings(): Settings;
  log(kind: LogEntry['kind'], text: string): void;
  setStatus(text: string): void;
  /** Native folder dialog opened at defaultPath. null: cancelled. */
  pickFolder(defaultPath: string): Promise<string | null>;
  /** Tells the user why a folder was refused. The picker opens again afterwards. */
  refuseFolder(message: string): Promise<void>;
  /** The build step (#345). */
  build(job: BuildJob): Promise<void>;
  /** For tests: the estimate cap and extra env for the CLI. */
  estimateTimeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export type ConfirmOutcome =
  | { status: 'built'; folder: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

type State = 'idle' | 'estimating' | 'confirm' | 'folder' | 'building';

/** The box reads "build me [ ... ]": the request is "Build me " and what was typed. A
 *  "build me" typed anyway is not doubled. */
export function buildMeRequest(typed: string): string {
  const text = typed.trim().replace(/^build me\b[\s:,]*/i, '');
  return text ? `Build me ${text}` : '';
}

export class Flow {
  private state: State = 'idle';
  private estimateRun: EstimateHandle | null = null;
  private pending: { request: string; estimate: Estimate; extras: RunExtras } | null = null;

  constructor(private deps: FlowDeps) {}

  get busy(): boolean {
    return this.state !== 'idle' && this.state !== 'confirm';
  }

  /** Step 1, with what was typed after "build me" and the Advanced panel's options.
   *  On ok the flow waits for confirm() or cancel(). */
  async estimate(typed: string, options?: AdvancedOptions): Promise<EstimateOutcome> {
    const text = buildMeRequest(typed);
    if (!text) return { status: 'error', error: 'Type what you want first.' };
    if (this.busy) return { status: 'error', error: 'Something is already running.' };
    this.pending = null;
    const checked = checkOptions(options);
    if (!checked.ok) return { status: 'error', error: checked.error };
    const { extras } = checked;

    const { log, setStatus } = this.deps;
    this.state = 'estimating';
    setStatus('Estimating...');
    log('info', `Request: ${text}`);
    if (extras.capMinutes) log('info', `Time cap for this run: ${extras.capMinutes} min.`);
    if (extras.style) log('info', `Design style: ${extras.style}`);
    if (extras.files.length) log('info', `Files: ${extras.files.map((f) => f.name).join(', ')} (only their names, types and sizes go to the estimate).`);
    log('info', 'Asking Claude for an estimate (no tools, temporary empty folder)...');
    const run = startEstimate({
      cliPath: this.deps.settings().claudePath,
      request: text,
      style: extras.style,
      files: extras.files,
      timeoutMs: this.deps.estimateTimeoutMs,
      env: this.deps.env,
      onStdout: (line) => log('stdout', line),
      onStderr: (line) => log('stderr', line),
    });
    this.estimateRun = run;
    const outcome = await run.done;
    this.estimateRun = null;

    if (outcome.status === 'ok') {
      this.pending = { request: text, estimate: outcome.estimate, extras };
      this.state = 'confirm';
      log('info', `Estimate: about ${outcome.estimate.minutes} minutes.`);
      setStatus('Waiting for you to confirm');
    } else {
      this.state = 'idle';
      if (outcome.status === 'stopped') {
        log('info', 'Estimate stopped.');
        setStatus('Cancelled');
      } else {
        log('error', outcome.error);
        setStatus('The estimate failed');
      }
    }
    return outcome;
  }

  /** Stops a running estimate (the build has its own Stop through startRun). */
  stop(): void {
    this.estimateRun?.stop();
  }

  /** "Cancel" in the confirm dialog. */
  cancel(): void {
    if (this.state !== 'confirm') return;
    this.pending = null;
    this.state = 'idle';
    this.deps.log('info', 'Cancelled.');
    this.deps.setStatus('Ready');
  }

  /** "Build it": pick an empty folder, git init it, hand over to the build step. */
  async confirm(): Promise<ConfirmOutcome> {
    if (this.state !== 'confirm' || !this.pending) return { status: 'error', error: 'There is no estimate to build.' };
    const { request, estimate, extras } = this.pending;
    const { log, setStatus } = this.deps;
    this.state = 'folder';
    setStatus('Choose a folder for the project');
    try {
      const settings = this.deps.settings();
      let folder: string | null = null;
      for (;;) {
        const picked = await this.deps.pickFolder(settings.projectsFolder);
        if (!picked) break;
        const prepared = await prepareProjectFolder(picked);
        if (prepared.ok) {
          folder = picked;
          break;
        }
        log('error', prepared.error);
        await this.deps.refuseFolder(prepared.error);
      }
      if (!folder) {
        log('info', 'Cancelled: no folder chosen.');
        setStatus('Ready');
        return { status: 'cancelled' };
      }
      log('info', `Project folder: ${folder} (new git repo with an empty first commit)`);
      let files: BuildJob['files'] = [];
      if (extras.files.length) {
        setStatus('Copying your files');
        try {
          files = await copyIntoAssets(folder, extras.files);
        } catch (err) {
          throw new Error(`Could not copy your files into ${path.join(folder, ASSETS_DIR)}: ${(err as Error).message}`);
        }
        log('info', `Copied into assets/ and committed: ${files.map((f) => f.name).join(', ')}`);
      }

      this.state = 'building';
      setStatus('Building...');
      await this.deps.build({
        request,
        estimate,
        folder,
        settings,
        ...(extras.capMinutes ? { capMinutes: extras.capMinutes } : {}),
        style: extras.style,
        files,
      });
      setStatus('Ready');
      return { status: 'built', folder };
    } catch (err) {
      const error = (err as Error).message;
      log('error', error);
      setStatus('Ready');
      return { status: 'error', error };
    } finally {
      this.pending = null;
      this.state = 'idle';
    }
  }
}
