// The build step: one headless Claude Code run in the new project folder, its
// stream-json output turned into a readable log, then the outcome saved to history.
// The flow calls runBuild once the user has confirmed the estimate and the project
// folder is a fresh git repo. No Electron imports.

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Estimate } from './estimate';
import { addHistory, type BuildResult, type Commit, type HistoryEntry } from './history';
import { git } from './project';
import type { RunOptions, RunResult } from './runner';
import type { Settings } from './settings';
import { parseStreamLine, type StreamResult } from './stream';

export interface BuildJob {
  /** What the user typed. */
  request: string;
  estimate: Estimate;
  /** The new project folder: empty apart from .git, with one empty commit. */
  folder: string;
  /** Settings as they were when the user pressed "Build it" (cap, skip permissions, CLI path). */
  settings: Settings;
}

export type BuildEvent =
  | {
      type: 'started';
      request: string;
      folder: string;
      startedAt: string;
      estimateMinutes: number;
      capMinutes: number;
      skipPermissions: boolean;
    }
  | { type: 'ended'; entry: HistoryEntry };

export interface BuildContext {
  log(kind: LogEntry['kind'], text: string): void;
  setStatus(text: string): void;
  /** main.ts's startRun: runs the CLI so Stop can kill it. */
  startRun(opts: RunOptions): Promise<RunResult>;
  /** Where history.json lives (the app's userData folder). */
  historyDir: string;
  /** Start and end of the build, for the window. */
  onEvent?(event: BuildEvent): void;
  /** For tests: overrides the cap from settings, and extra env for the CLI. */
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /** For tests: another prompt file. Default PROMPT_FILE. */
  promptFile?: string;
}

/** The build prompt, editable; read at every build. */
export const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'build.md');

/** Commands Claude may run when the permission-skip setting is off. */
export const ALLOWED_COMMANDS = ['npm', 'npx', 'node', 'python', 'py', 'pip', 'dotnet', 'git'];

/** Headless with streamed JSON events (the CLI wants --verbose for stream-json with -p).
 *  Permissions: everything when skipPermissions is on; otherwise file edits in the
 *  folder plus ALLOWED_COMMANDS. In -p mode anything else is refused without a prompt.
 *  --allowedTools takes a list, so it goes last. */
export function buildArgs(skipPermissions: boolean): string[] {
  const base = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (skipPermissions) return [...base, '--dangerously-skip-permissions'];
  return [...base, '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED_COMMANDS.map((c) => `Bash(${c} *)`)];
}

/** The permissions line for the prompt and the window. */
export function permissionsNote(skipPermissions: boolean): string {
  if (skipPermissions) return 'You may run any command you need, but only for this project and only inside this folder.';
  return (
    `You can edit files in this folder and run only these commands: ${listWords(ALLOWED_COMMANDS)}. ` +
    'Any other command is refused without asking anyone, so do not rely on them (write a small node or python script instead).'
  );
}

/** Fills the template's {{request}}, {{summary}}, {{stack}}, {{steps}}, {{folder}} and
 *  {{permissions}} in one pass, so text in the request is never filled in again.
 *  Line endings become \n (a Windows checkout has the file with \r\n). */
export function buildPrompt(template: string, job: BuildJob): string {
  const { estimate } = job;
  const values: Record<string, string> = {
    request: job.request,
    summary: estimate.summary,
    stack: estimate.stack || '(none given: pick one that fits)',
    steps: estimate.steps.length ? estimate.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none given)',
    folder: job.folder,
    permissions: permissionsNote(job.settings.skipPermissions),
  };
  return template.replace(/\r\n/g, '\n').replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in values ? values[key] : m));
}

/** Builds job.request in job.folder. Resolves with the history entry when the build has ended. */
export async function runBuild(job: BuildJob, ctx: BuildContext): Promise<HistoryEntry> {
  const { log, setStatus } = ctx;
  const startedAt = new Date();
  const capMinutes = job.settings.buildCapMinutes;
  const finish = (result: BuildResult, summary: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => {
    const entry: HistoryEntry = {
      id: randomUUID(),
      request: job.request,
      folder: job.folder,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      result,
      summary,
      estimateMinutes: job.estimate.minutes,
      commits: [],
      hasReadme: existsSync(path.join(job.folder, 'README.md')),
      ...extra,
    };
    try {
      addHistory(ctx.historyDir, entry);
    } catch (err) {
      log('error', `Could not save the history: ${(err as Error).message}`);
    }
    log(result === 'done' ? 'info' : 'error', `Build ${result} after ${formatDuration(entry.durationMs)}.`);
    setStatus(`Build ${result}`);
    ctx.onEvent?.({ type: 'ended', entry });
    return entry;
  };

  ctx.onEvent?.({
    type: 'started',
    request: job.request,
    folder: job.folder,
    startedAt: startedAt.toISOString(),
    estimateMinutes: job.estimate.minutes,
    capMinutes,
    skipPermissions: job.settings.skipPermissions,
  });

  let prompt: string;
  try {
    prompt = buildPrompt(readFileSync(ctx.promptFile ?? PROMPT_FILE, 'utf8'), job);
  } catch (err) {
    return finish('failed', `Could not read the build prompt: ${(err as Error).message}`);
  }

  const base = (await git(job.folder, ['rev-parse', 'HEAD']).catch(() => '')).trim();
  log('info', `Building in ${job.folder}. Time cap: ${capMinutes} min.`);
  log(
    'info',
    job.settings.skipPermissions
      ? 'Permissions: none asked (--dangerously-skip-permissions).'
      : `Permissions: file edits in the folder, and only ${listWords(ALLOWED_COMMANDS)} as commands; others fail without a prompt.`,
  );

  let streamResult: StreamResult | undefined;
  let lastText = '';
  const stderr: string[] = [];
  const run = await ctx.startRun({
    cliPath: job.settings.claudePath,
    args: buildArgs(job.settings.skipPermissions),
    cwd: job.folder,
    stdin: prompt,
    timeoutMs: ctx.timeoutMs ?? capMinutes * 60_000,
    env: ctx.env,
    onStdout: (line) => {
      const parsed = parseStreamLine(line, job.folder);
      for (const e of parsed.entries) {
        if (e.kind === 'assistant') lastText = e.text;
        log(e.kind, e.text);
      }
      if (parsed.result) streamResult = parsed.result;
    },
    onStderr: (line) => {
      stderr.push(line);
      if (stderr.length > 20) stderr.shift();
      log('stderr', line);
    },
  });

  const commits = base ? await listCommits(job.folder, base) : [];
  const said = (streamResult?.text || lastText).trim();
  const lastWords = said ? `\n\nThe last thing Claude said:\n${said}` : '';
  const took = formatDuration(run.durationMs);
  const extra = { commits };

  switch (run.status) {
    case 'stopped':
      return finish('stopped', `Stopped after ${took}.${lastWords}`, extra);
    case 'timeout':
      return finish('timed out', `The ${capMinutes} min time cap ran out, so the build was stopped.${lastWords}`, extra);
    case 'error':
      return finish('failed', run.error ?? 'The Claude CLI could not be started.', extra);
  }
  if (run.exitCode === 0 && streamResult && !streamResult.isError) {
    return finish('done', streamResult.text.trim() || lastText || 'Claude finished without a summary.', extra);
  }
  const why = streamResult ? 'Claude reported an error' : `The Claude CLI ended without a result (exit code ${run.exitCode})`;
  const detail = said || stderr.join('\n').trim();
  return finish('failed', `${why}.${detail ? `\n\n${detail}` : ''}`, extra);
}

/** Commits after base on the current branch, oldest first. */
export async function listCommits(folder: string, base: string): Promise<Commit[]> {
  try {
    const out = await git(folder, ['log', '--reverse', '--format=%h%x09%s', `${base}..HEAD`]);
    return out
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        const tab = l.indexOf('\t');
        return { hash: l.slice(0, tab), subject: l.slice(tab + 1) };
      });
  } catch {
    return [];
  }
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

function listWords(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
