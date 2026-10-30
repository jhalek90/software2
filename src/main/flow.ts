// What happens after Go: estimate -> confirm -> new folder -> build. The folder is named
// by the estimate (or from the request) and made in the projects folder from Settings;
// nobody picks it. The steps that need Electron (the window, the build's log) come in as
// functions, so the tests run this under Node.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { ASSETS_DIR, checkOptions, copyIntoAssets, type AdvancedOptions, type RunExtras } from './advanced';
import type { BuildJob } from './build';
import { startEstimate, type Estimate, type EstimateHandle, type EstimateOutcome } from './estimate';
import { projectName } from './naming';
import { createProjectFolder, initRepo, plannedFolder } from './project';
import type { Settings } from './settings';

export interface FlowDeps {
  settings(): Settings;
  log(kind: LogEntry['kind'], text: string): void;
  setStatus(text: string): void;
  /** The build step (#345). */
  build(job: BuildJob): Promise<void>;
  /** For tests: the estimate cap and extra env for the CLI. */
  estimateTimeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/** The estimate's outcome; on ok also the folder the project will be created in
 *  (shown on the confirm card; a "-2" may still be added if it is taken by then). */
export type GoOutcome = Exclude<EstimateOutcome, { status: 'ok' }> | { status: 'ok'; estimate: Estimate; folder: string };

export type ConfirmOutcome = { status: 'built'; folder: string } | { status: 'error'; error: string };

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
  async estimate(typed: string, options?: AdvancedOptions): Promise<GoOutcome> {
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
      const estimate = { ...outcome.estimate, name: projectName(outcome.estimate.name, text) };
      this.pending = { request: text, estimate, extras };
      this.state = 'confirm';
      const folder = plannedFolder(this.deps.settings().projectsFolder, estimate.name);
      log('info', `Estimate: about ${estimate.minutes} minutes.`);
      log('info', `Project name: ${estimate.name}${outcome.estimate.name ? '' : ' (from the request: the estimate had none)'}. Will be created in ${folder}`);
      setStatus('Waiting for you to confirm');
      return { status: 'ok', estimate, folder };
    }
    this.state = 'idle';
    if (outcome.status === 'stopped') {
      log('info', 'Estimate stopped.');
      setStatus('Cancelled');
    } else {
      log('error', outcome.error);
      setStatus('The estimate failed');
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

  /** "Build it": make the project's new folder, git init it, hand over to the build step. */
  async confirm(): Promise<ConfirmOutcome> {
    if (this.state !== 'confirm' || !this.pending) return { status: 'error', error: 'There is no estimate to build.' };
    const { request, estimate, extras } = this.pending;
    const { log, setStatus } = this.deps;
    this.state = 'folder';
    setStatus('Creating the project folder');
    try {
      const settings = this.deps.settings();
      const created = createProjectFolder(settings.projectsFolder, estimate.name);
      if (!created.ok) throw new Error(created.error);
      const { folder } = created;
      const repo = await initRepo(folder);
      if (!repo.ok) {
        // The folder was made just now and has nothing of anyone's in it.
        rmSync(folder, { recursive: true, force: true, maxRetries: 2 });
        throw new Error(repo.error);
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
