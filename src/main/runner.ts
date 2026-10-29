// Runs the claude CLI (or the fake one in tests) as a child process.
// One function, runClaude: spawn with args, working folder and stdin, stream
// output line by line, Stop kills the whole process tree, hard time cap.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export interface RunOptions {
  /** Path to the CLI: an .exe, a .cmd/.bat shim, or a .js/.mjs/.cjs script (run with Node). */
  cliPath: string;
  args: string[];
  /** Working folder for the process. Must exist. */
  cwd: string;
  /** Written to the process's stdin, which is then closed. */
  stdin?: string;
  /** Hard time cap in milliseconds; the process tree is killed when it runs out. 0 or unset: no cap. */
  timeoutMs?: number;
  /** Extra environment variables, merged over process.env. */
  env?: Record<string, string | undefined>;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export type RunStatus = 'exited' | 'stopped' | 'timeout' | 'error';

export interface RunResult {
  /** exited: the process ended by itself (check exitCode); stopped: stop() was called;
   *  timeout: the time cap ran out; error: it could not be started. */
  status: RunStatus;
  exitCode: number | null;
  error?: string;
  durationMs: number;
}

export interface RunHandle {
  pid: number | undefined;
  stop(): void;
  done: Promise<RunResult>;
}

/** How long to wait for stdout/stderr to close after the process exits. Background
 *  grandchildren can inherit the pipes and keep them open forever. */
const CLOSE_GRACE_MS = 2000;

export function runClaude(opts: RunOptions): RunHandle {
  const started = Date.now();
  const fail = (error: string): RunHandle => ({
    pid: undefined,
    stop() {},
    done: Promise.resolve({ status: 'error', exitCode: null, error, durationMs: Date.now() - started }),
  });

  if (!opts.cliPath || !existsSync(opts.cliPath)) {
    return fail(`Claude CLI not found at "${opts.cliPath}". Check the path in Settings.`);
  }
  if (!existsSync(opts.cwd) || !statSync(opts.cwd).isDirectory()) {
    return fail(`Working folder does not exist: "${opts.cwd}".`);
  }

  let child: ChildProcess;
  try {
    child = spawnCli(opts);
  } catch (err) {
    return fail(`Could not start the Claude CLI: ${(err as Error).message}`);
  }

  let endReason: 'stopped' | 'timeout' | null = null;
  let timer: NodeJS.Timeout | undefined;

  const done = new Promise<RunResult>((resolve) => {
    let settled = false;
    let spawnError: string | undefined;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      flushOut();
      flushErr();
      const durationMs = Date.now() - started;
      if (spawnError) resolve({ status: 'error', exitCode, error: spawnError, durationMs });
      else resolve({ status: endReason ?? 'exited', exitCode, durationMs });
    };

    const flushOut = lineSplitter(child.stdout, opts.onStdout);
    const flushErr = lineSplitter(child.stderr, opts.onStderr);

    child.on('error', (err) => {
      spawnError = `Could not start the Claude CLI: ${err.message}`;
      // 'close' may never follow an error that happened before the spawn.
      if (child.pid === undefined) finish(null);
    });
    child.on('exit', (code) => {
      setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(code);
      }, CLOSE_GRACE_MS).unref();
    });
    child.on('close', (code) => finish(code));
  });

  // The process may exit before reading stdin; ignore the resulting EPIPE.
  child.stdin?.on('error', () => {});
  child.stdin?.end(opts.stdin ?? '');

  const kill = (reason: 'stopped' | 'timeout') => {
    if (endReason || child.exitCode !== null || child.signalCode !== null) return;
    endReason = reason;
    killTree(child);
  };

  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => kill('timeout'), opts.timeoutMs);
  }

  return { pid: child.pid, stop: () => kill('stopped'), done };
}

function spawnCli(opts: RunOptions): ChildProcess {
  const env = { ...process.env, ...opts.env };
  const common = { cwd: opts.cwd, env, windowsHide: true, stdio: 'pipe' as const };
  const ext = path.extname(opts.cliPath).toLowerCase();

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    // In Electron, process.execPath is electron.exe; this makes it behave as plain Node.
    return spawn(process.execPath, [opts.cliPath, ...opts.args], {
      ...common,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    });
  }
  if (ext === '.cmd' || ext === '.bat') {
    // Node refuses to spawn batch files without a shell, so go through cmd.exe ourselves.
    const line = [opts.cliPath, ...opts.args].map(quoteForCmd).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
      ...common,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(opts.cliPath, opts.args, common);
}

/** Quotes one argument for a cmd.exe command line. Characters cmd expands even inside
 *  quotes (%, !) and line breaks are refused rather than escaped: the prompt goes
 *  through stdin, so the arguments are only ever plain flags and paths. */
function quoteForCmd(arg: string): string {
  if (/[%!\r\n"]/.test(arg)) {
    throw new Error(`Argument not allowed for a .cmd CLI: ${JSON.stringify(arg)}`);
  }
  return /^[\w\-.:\\/=,@+]+$/.test(arg) ? arg : `"${arg}"`;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // /T takes the children too (cmd.exe -> node -> anything it started).
    const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    tk.on('error', () => child.kill());
  } else {
    child.kill('SIGKILL');
  }
}

/** Calls onLine for each complete line (without \r\n). Returns a flush function for
 *  the last unterminated line. */
function lineSplitter(stream: NodeJS.ReadableStream | null, onLine?: (line: string) => void): () => void {
  let buf = '';
  if (!stream) return () => {};
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      onLine?.(line);
    }
  });
  stream.on('error', () => {});
  return () => {
    if (buf) {
      const rest = buf.replace(/\r$/, '');
      buf = '';
      onLine?.(rest);
    }
  };
}
