// The estimate step: ask the CLI, headless and with no tools, how long the build will
// take and what it would build. No Electron imports, so the tests run it under Node.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClaude, type RunHandle, type RunOptions } from './runner';

export interface Estimate {
  minutes: number;
  summary: string;
  stack: string;
  steps: string[];
  risks: string[];
}

export type ParseResult = { ok: true; estimate: Estimate } | { ok: false; error: string };

export type EstimateOutcome =
  | { status: 'ok'; estimate: Estimate }
  /** The CLI answered but no estimate could be read from it; raw is what it said. */
  | { status: 'unreadable'; error: string; raw: string }
  | { status: 'timeout'; error: string }
  | { status: 'stopped' }
  | { status: 'error'; error: string; raw?: string };

export const ESTIMATE_TIMEOUT_MS = 60_000;

/** Headless, one JSON result, nothing saved. `--tools ""` turns off every built-in tool
 *  (from `claude --help`) and `--strict-mcp-config` with no `--mcp-config` loads no MCP
 *  servers, so the model can only answer. The prompt goes in through stdin. */
export const ESTIMATE_ARGS = [
  '-p',
  '--output-format',
  'json',
  '--tools',
  '',
  '--strict-mcp-config',
  '--no-session-persistence',
];

export function estimatePrompt(request: string): string {
  return [
    'software2 estimate request.',
    'Do not build anything and do not use any tools. Only answer.',
    '',
    'Someone wants this software:',
    '<request>',
    request.trim(),
    '</request>',
    '',
    'Later, one headless Claude Code run will build it in one go, in a new empty folder',
    'on Windows, with local git only. Estimate that run.',
    '',
    'Reply with one JSON object and nothing else: no prose, no code fences. Exactly these keys:',
    '{ "minutes": number, "summary": "one sentence of what will be built", "stack": "language/framework it would use", "steps": ["3 to 6 short steps"], "risks": ["0 to 3"] }',
    'minutes is how long the build run would take, in whole minutes.',
  ].join('\n');
}

export interface EstimateOptions {
  cliPath: string;
  request: string;
  /** Default ESTIMATE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Parent for the temporary empty working folder. Default: the OS temp folder. */
  tmpParent?: string;
  env?: RunOptions['env'];
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface EstimateHandle {
  stop(): void;
  done: Promise<EstimateOutcome>;
}

/** Runs the estimate in a temporary empty folder, which is removed afterwards. */
export function startEstimate(opts: EstimateOptions): EstimateHandle {
  let cwd: string;
  try {
    cwd = mkdtempSync(path.join(opts.tmpParent ?? os.tmpdir(), 'software2-estimate-'));
  } catch (err) {
    const error = `Could not make a temporary folder: ${(err as Error).message}`;
    return { stop() {}, done: Promise.resolve({ status: 'error', error }) };
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const timeoutMs = opts.timeoutMs ?? ESTIMATE_TIMEOUT_MS;
  const run: RunHandle = runClaude({
    cliPath: opts.cliPath,
    args: ESTIMATE_ARGS,
    cwd,
    stdin: estimatePrompt(opts.request),
    timeoutMs,
    env: opts.env,
    onStdout: (line) => {
      stdout.push(line);
      opts.onStdout?.(line);
    },
    onStderr: (line) => {
      stderr.push(line);
      opts.onStderr?.(line);
    },
  });

  const done = run.done
    .then((res): EstimateOutcome => {
      if (res.status === 'stopped') return { status: 'stopped' };
      if (res.status === 'timeout') {
        return { status: 'timeout', error: `The estimate took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.` };
      }
      if (res.status === 'error') return { status: 'error', error: res.error ?? 'The Claude CLI could not be started.' };

      const reply = readCliReply(stdout.join('\n'));
      if (res.exitCode !== 0 || reply.isError) {
        const detail = (reply.text || stderr.join('\n')).trim();
        return {
          status: 'error',
          error: `The Claude CLI failed (exit code ${res.exitCode}).`,
          raw: detail || undefined,
        };
      }
      const parsed = parseEstimate(reply.text);
      if (parsed.ok) return { status: 'ok', estimate: parsed.estimate };
      return { status: 'unreadable', error: parsed.error, raw: reply.text };
    })
    .finally(() => {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // A leftover empty temp folder is harmless.
      }
    });

  return { stop: () => run.stop(), done };
}

/** Gets the model's text out of `--output-format json` output: one result object with
 *  `result` and `is_error`. Anything else is returned as it is. */
export function readCliReply(stdout: string): { text: string; isError: boolean } {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === 'object' && obj.type === 'result') {
        return { text: typeof obj.result === 'string' ? obj.result : '', isError: obj.is_error === true };
      }
    } catch {
      // Not a JSON line.
    }
  }
  return { text: stdout, isError: false };
}

/** Reads an estimate from the model's reply: plain JSON, JSON in a code fence, or JSON
 *  somewhere in prose. The first object that has the right shape wins. */
export function parseEstimate(text: string): ParseResult {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g)) candidates.push(m[1]);
  candidates.push(text);

  let firstError: string | null = null;
  let sawObject = false;
  for (const candidate of candidates) {
    for (const obj of jsonObjects(candidate)) {
      sawObject = true;
      const res = toEstimate(obj);
      if (res.ok) return res;
      firstError ??= res.error;
    }
  }
  if (firstError) return { ok: false, error: firstError };
  return { ok: false, error: sawObject ? 'The reply had no estimate in it.' : 'The reply was not JSON.' };
}

/** Yields every top-level-looking JSON object in text, scanning from each "{". */
function* jsonObjects(text: string): Generator<unknown> {
  let tries = 0;
  for (let start = text.indexOf('{'); start !== -1 && tries < 200; start = text.indexOf('{', start + 1), tries++) {
    const end = matchingBrace(text, start);
    if (end === -1) continue;
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) yield obj;
    } catch {
      // Not valid JSON from here; try the next "{".
    }
  }
}

/** Index of the "}" closing the "{" at start, skipping braces inside strings. -1 if none. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function toEstimate(raw: unknown): ParseResult {
  const r = raw as Record<string, unknown>;
  const minutes = typeof r.minutes === 'number' ? r.minutes : parseFloat(String(r.minutes ?? ''));
  if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, error: 'The estimate has no number of minutes.' };
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!summary) return { ok: false, error: 'The estimate has no summary.' };
  const strings = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim())
      .slice(0, max);
  return {
    ok: true,
    estimate: {
      minutes: Math.min(Math.max(1, Math.round(minutes)), 24 * 60),
      summary,
      stack: typeof r.stack === 'string' ? r.stack.trim() : '',
      steps: strings(r.steps, 6),
      risks: strings(r.risks, 3),
    },
  };
}
