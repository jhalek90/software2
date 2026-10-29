// What happens after Go: estimate -> confirm -> folder -> build. The steps that need
// Electron (dialogs, the window) come in as functions, so the tests run this under Node.

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

export class Flow {
  private state: State = 'idle';
  private estimateRun: EstimateHandle | null = null;
  private pending: { request: string; estimate: Estimate } | null = null;

  constructor(private deps: FlowDeps) {}

  get busy(): boolean {
    return this.state !== 'idle' && this.state !== 'confirm';
  }

  /** Step 1. On ok the flow waits for confirm() or cancel(). */
  async estimate(request: string): Promise<EstimateOutcome> {
    const text = request.trim();
    if (!text) return { status: 'error', error: 'Type what you want first.' };
    if (this.busy) return { status: 'error', error: 'Something is already running.' };
    this.pending = null;

    const { log, setStatus } = this.deps;
    this.state = 'estimating';
    setStatus('Estimating...');
    log('info', `Request: ${text}`);
    log('info', 'Asking Claude for an estimate (no tools, temporary empty folder)...');
    const run = startEstimate({
      cliPath: this.deps.settings().claudePath,
      request: text,
      timeoutMs: this.deps.estimateTimeoutMs,
      env: this.deps.env,
      onStdout: (line) => log('stdout', line),
      onStderr: (line) => log('stderr', line),
    });
    this.estimateRun = run;
    const outcome = await run.done;
    this.estimateRun = null;

    if (outcome.status === 'ok') {
      this.pending = { request: text, estimate: outcome.estimate };
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
    const { request, estimate } = this.pending;
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

      this.state = 'building';
      setStatus('Building...');
      await this.deps.build({ request, estimate, folder, settings });
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
