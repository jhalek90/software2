// "How to run it" for a finished build, and its Run now button. No Electron imports.
// The build prompt asks Claude to end by writing RUN.json in the project root:
//   { "kind": "static" | "command", "open": "index.html", "install": "npm install",
//     "command": "npm run dev", "url": "http://localhost:5173", "steps": [...], "notes": "..." }
// readHowToRun() reads it when a build is done; if it is missing or broken, the README's
// "How to run" section is shown instead, and if that is missing too, the card says so.
// Run now only ever runs what RUN.json says, in a visible terminal window (RunNow).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

export const RUN_FILE = 'RUN.json';

export interface RunSpec {
  kind: 'static' | 'command';
  /** static: the file to open, relative to the project folder. */
  open?: string;
  /** command: run once before the command if what it installs is missing (node_modules). */
  install?: string;
  /** command: what starts the app, run in the project folder. */
  command?: string;
  /** command: the address it serves, opened in the browser once it answers. Local only. */
  url?: string;
  /** One to six plain steps a person would follow. */
  steps: string[];
  notes?: string;
}

/** What the result card shows under "How to run it". */
export type HowToRun =
  | { source: 'run.json'; spec: RunSpec }
  /** No usable RUN.json; problem says why. text: the README's "How to run" section. */
  | { source: 'readme'; problem: string; text: string }
  | { source: 'none'; problem: string };

const MAX_STEPS = 6;
const MAX_TEXT = 300;
const MAX_NOTES = 600;
const MAX_README_SECTION = 2500;

/** RUN.json's text -> a checked RunSpec, or why it cannot be used. folder: to check that
 *  a static app's file is there and inside the project. */
export function parseRunSpec(text: string, folder: string): { spec: RunSpec } | { problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { problem: 'RUN.json is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'RUN.json is not a JSON object.' };
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const command = str(r.command);
  const open = str(r.open);
  const kind = r.kind === 'static' || r.kind === 'command' ? r.kind : command ? 'command' : open ? 'static' : undefined;
  if (!kind) return { problem: 'RUN.json says neither "static" with a file to open nor "command" with a command to run.' };

  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => str(s))
    .filter((s): s is string => !!s)
    .slice(0, MAX_STEPS);
  const notes = str(r.notes, MAX_NOTES);
  const spec: RunSpec = { kind, steps, ...(notes ? { notes } : {}) };

  if (kind === 'static') {
    if (!open) return { problem: 'RUN.json says "static" but gives no file to open.' };
    const file = insideFolder(folder, open);
    if (!file) return { problem: `RUN.json's file to open, "${open}", is outside the project folder.` };
    if (!existsSync(file) || !statSync(file).isFile()) return { problem: `RUN.json says to open "${open}", but that file is not there.` };
    spec.open = path.relative(folder, file).split(path.sep).join('/');
    if (!steps.length) spec.steps = [`Open ${spec.open} in your browser (Run now does that).`];
    return { spec };
  }

  if (!command) return { problem: 'RUN.json says "command" but gives no command.' };
  const install = str(r.install);
  for (const [name, value] of [['command', command], ['install', install]] as const) {
    if (value && /[\r\n]/.test(value)) return { problem: `RUN.json's ${name} is more than one line.` };
  }
  spec.command = command;
  if (install) spec.install = install;
  if (r.url !== undefined && r.url !== '') {
    const url = localUrl(r.url);
    if (!url) return { problem: 'RUN.json\'s url is not a local http address (like http://localhost:5173).' };
    spec.url = url;
  }
  if (!steps.length) {
    spec.steps = [
      'Open a terminal in the project folder.',
      ...(install ? [`Run ${install} (once).`] : []),
      `Run ${command}.`,
      ...(spec.url ? [`Open ${spec.url} in your browser.`] : []),
    ];
  }
  return { spec };
}

/** The full path of rel inside folder, or null if it points outside it. */
function insideFolder(folder: string, rel: string): string | null {
  if (path.isAbsolute(rel)) return null;
  const full = path.resolve(folder, rel);
  const back = path.relative(folder, full);
  return back && !back.startsWith('..') && !path.isAbsolute(back) ? full : null;
}

/** http(s) on this PC only: Run now never opens other sites. */
export function localUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname)) return null;
    if (u.hostname === '0.0.0.0') u.hostname = 'localhost'; // a server's "all addresses"; browsers can't open it
    return u.href;
  } catch {
    return null;
  }
}

/** The README's "How to run" section (heading "How to run", "Running", "Run it",
 *  "Getting started", "Usage" or "Quick start"), without its heading, up to the next heading
 *  of the same or a higher level. Empty if there is none. */
export function readmeHowToRun(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const heading = (l: string) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
  const wanted = /^(how to (run|use|start|play|open)|running( it| the app)?|run( it| the app| locally)?|getting started|quick ?start|usage)\b/i;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const h = fence ? null : heading(lines[i]);
    if (!h || !wanted.test(h[2])) continue;
    const level = h[1].length;
    const body: string[] = [];
    let inFence = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(```|~~~)/.test(lines[j])) {
        inFence = !inFence;
        continue; // the fences themselves are left out; the commands in them stay
      }
      const next = inFence ? null : heading(lines[j]);
      if (next && next[1].length <= level) break;
      body.push(lines[j]);
    }
    const text = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text) return text.length > MAX_README_SECTION ? `${text.slice(0, MAX_README_SECTION - 1)}…` : text;
  }
  return '';
}

/** How to run the app in folder: RUN.json, else the README's section, else nothing. */
export function readHowToRun(folder: string): HowToRun {
  let problem: string;
  const file = path.join(folder, RUN_FILE);
  if (existsSync(file)) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // Unreadable: same as broken.
    }
    const parsed = parseRunSpec(text, folder);
    if ('spec' in parsed) return { source: 'run.json', spec: parsed.spec };
    problem = parsed.problem;
  } else {
    problem = 'There is no RUN.json.';
  }
  let readme = '';
  try {
    readme = readFileSync(path.join(folder, 'README.md'), 'utf8');
  } catch {
    return { source: 'none', problem: `${problem} There is no README.md either.` };
  }
  const text = readmeHowToRun(readme);
  if (text) return { source: 'readme', problem, text };
  return { source: 'none', problem: `${problem} The README has no "How to run" section.` };
}

// Run now

/** What Run now does for a spec. */
export type RunPlan =
  | { kind: 'static'; folder: string; file: string }
  | {
      kind: 'command';
      folder: string;
      /** Only when given and what it installs is missing. */
      install?: string;
      command: string;
      url?: string;
    };

/** Install steps run only when what they install is missing; this tells for the common
 *  ones (node_modules for npm, pnpm, yarn and bun). Others always run (they are meant to
 *  be safe to repeat, like pip install -r requirements.txt). */
export function installNeeded(install: string, folder: string): boolean {
  if (/^(npm|pnpm|yarn|bun)(\.cmd)?\b/i.test(install.trim())) return !existsSync(path.join(folder, 'node_modules'));
  return true;
}

export function runPlan(spec: RunSpec, folder: string): RunPlan {
  if (spec.kind === 'static') return { kind: 'static', folder, file: path.join(folder, spec.open ?? 'index.html') };
  return {
    kind: 'command',
    folder,
    ...(spec.install && installNeeded(spec.install, folder) ? { install: spec.install } : {}),
    command: spec.command ?? '',
    ...(spec.url ? { url: spec.url } : {}),
  };
}

/** The batch file the terminal window runs: into the folder, the install (stopping if it
 *  fails), then the command. Echo is on for the commands, so the window shows each one
 *  exactly as it runs. The commands are RUN.json's, word for word; only the folder and the
 *  title have their % doubled (a batch file would expand them). UTF-8, with chcp 65001. */
export function terminalScript(plan: Extract<RunPlan, { kind: 'command' }>, name: string): string {
  const safe = (s: string) => s.replace(/%/g, '%%').replace(/["\r\n]/g, '');
  const title = safe(`software2: ${name}`).replace(/[&|<>^]/g, ' ');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    `title ${title}`,
    `cd /d "${safe(plan.folder)}" || (echo Could not open the project folder. & pause & exit /b 1)`,
    'echo software2: running the commands from RUN.json in this folder.',
    'echo Close this window to stop the app.',
    'echo.',
  ];
  if (plan.install) {
    lines.push('@echo on', `call ${plan.install}`, '@echo off');
    lines.push('if errorlevel 1 (echo. & echo The install step failed, so the app was not started. & pause & exit /b 1)');
    lines.push('echo.');
  }
  lines.push('@echo on', `call ${plan.command}`, '@echo off');
  lines.push('echo.', 'echo The app has stopped. Press a key to close this window.', 'pause >nul');
  return lines.join('\r\n') + '\r\n';
}

/** Polls url until anything answers (any HTTP status), up to timeoutMs. */
export function waitForUrl(url: string, timeoutMs: number, everyMs = 500): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  const once = () =>
    new Promise<boolean>((resolve) => {
      const answered = (res: http.IncomingMessage) => {
        res.resume();
        resolve(true);
      };
      // A local dev server's https is self-signed; any answer means it is up.
      const req = url.startsWith('https:')
        ? https.get(url, { timeout: 2000, rejectUnauthorized: false }, answered)
        : http.get(url, { timeout: 2000 }, answered);
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(false));
    });
  return new Promise((resolve) => {
    const tryNow = async () => {
      if (await once()) return resolve(true);
      if (Date.now() + everyMs > end) return resolve(false);
      setTimeout(tryNow, everyMs);
    };
    tryNow();
  });
}

/** What Run now said: confirm first (with the exact commands), started, or why not. */
export type RunNowResult =
  | {
      status: 'confirm';
      folder: string;
      install?: string;
      /** RUN.json's install, when it will be left out (node_modules is already there). */
      installSkipped?: string;
      command: string;
      url?: string;
    }
  | { status: 'started'; message: string }
  | { status: 'error'; message: string };

export interface RunNowDeps {
  /** Opens a file with its default app (the browser for .html). Resolves '' or an error. */
  openFile(file: string): Promise<string>;
  /** Opens a new, visible terminal window running the batch file. Resolves '' or an error. */
  openTerminal(script: string): Promise<string>;
  openUrl(url: string): Promise<void>;
  /** Later news about the url (opened, or it did not answer), for the result card. */
  note(text: string): void;
  /** Where the batch files go (the app's own folder). */
  scriptDir: string;
  waitForUrl?: typeof waitForUrl;
}

/** How long to wait for the url to answer: 30 s, or 5 min when an install runs first. */
export const URL_WAIT_MS = 30_000;
export const URL_WAIT_INSTALL_MS = 5 * 60_000;

/** Removes run scripts older than a day. Newer ones may still be running in their window
 *  (cmd reads a batch file as it goes, so a running one is never overwritten either). */
function pruneScripts(dir: string): void {
  const dayAgo = Date.now() - 86_400_000;
  for (const name of readdirSync(dir)) {
    if (!/^run-.*\.cmd$/.test(name)) continue;
    try {
      const file = path.join(dir, name);
      if (statSync(file).mtimeMs < dayAgo) rmSync(file);
    } catch {
      // In use or gone: left alone.
    }
  }
}

/** Run now. Commands run only after the person has seen them once for that project (in
 *  this session: there is no build history, so the result card is the only way back to
 *  a project). Asking again when RUN.json's commands are different. */
export class RunNow {
  private approved = new Set<string>();
  private scripts = 0;

  constructor(private deps: RunNowDeps) {}

  async run(spec: RunSpec, folder: string, name: string, confirmed = false): Promise<RunNowResult> {
    const plan = runPlan(spec, folder);
    if (plan.kind === 'static') {
      if (!existsSync(plan.file)) return { status: 'error', message: `${spec.open} is not there any more.` };
      const error = await this.deps.openFile(plan.file);
      return error
        ? { status: 'error', message: `Could not open ${spec.open}: ${error}` }
        : { status: 'started', message: `Opened ${spec.open} in your browser.` };
    }
    if (!existsSync(folder)) return { status: 'error', message: 'The project folder is not there any more.' };
    const key = [folder, spec.install ?? '', plan.command, plan.url ?? ''].join('\0');
    if (confirmed) this.approved.add(key);
    if (!this.approved.has(key)) {
      return {
        status: 'confirm',
        folder,
        ...(plan.install ? { install: plan.install } : {}),
        ...(spec.install && !plan.install ? { installSkipped: spec.install } : {}),
        command: plan.command,
        ...(plan.url ? { url: plan.url } : {}),
      };
    }

    let script: string;
    try {
      mkdirSync(this.deps.scriptDir, { recursive: true });
      pruneScripts(this.deps.scriptDir);
      script = path.join(this.deps.scriptDir, `run-${Date.now()}-${++this.scripts}.cmd`);
      writeFileSync(script, terminalScript(plan, name));
    } catch (err) {
      return { status: 'error', message: `Could not write the run script: ${(err as Error).message}` };
    }
    const error = await this.deps.openTerminal(script);
    if (error) return { status: 'error', message: `Could not open a terminal window: ${error}` };

    if (plan.url) {
      const url = plan.url;
      const wait = plan.install ? URL_WAIT_INSTALL_MS : URL_WAIT_MS;
      (this.deps.waitForUrl ?? waitForUrl)(url, wait).then(async (up) => {
        if (up) {
          await this.deps.openUrl(url);
          this.deps.note(`Opened ${url} in your browser. Close the terminal window to stop the app.`);
        } else {
          this.deps.note(`${url} did not answer within ${Math.round(wait / 1000)} s. Check the terminal window, then open it yourself.`);
        }
      });
    }
    const what = plan.install ? 'Installing, then starting' : 'Started';
    return {
      status: 'started',
      message: `${what} it in a new terminal window. ${plan.url ? `Opening ${plan.url} when it answers. ` : ''}Close that window to stop it.`,
    };
  }
}
