// Build-step tests: stream-json parsing, the flags for both permission settings, the
// prompt, and whole builds with test/fake-claude.mjs (done, stop, time cap, failure).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_COMMANDS, PROMPT_FILE, buildArgs, buildPrompt, formatDuration, runBuild } from '../dist/main/build.js';
import { createProjectFolder, initRepo } from '../dist/main/project.js';
import { runClaude } from '../dist/main/runner.js';
import { parseStreamLine, toolLine } from '../dist/main/stream.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-build-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const line = (obj) => JSON.stringify(obj);
const folder = path.join(tmp, 'proj');

const estimate = {
  minutes: 12,
  summary: 'A to-do list web page.',
  stack: 'HTML, CSS and JavaScript',
  steps: ['Write index.html', 'Add the list logic', 'Test it'],
  risks: [],
};
const settings = (over = {}) => ({ claudePath: FAKE, projectsFolder: tmp, buildCapMinutes: 30, skipPermissions: true, ...over });

// Parsing stream-json

test('the init event becomes one info line', () => {
  const { entries } = parseStreamLine(line({ type: 'system', subtype: 'init', model: 'm1', permissionMode: 'acceptEdits' }), folder);
  assert.deepEqual(entries, [{ kind: 'info', text: 'Claude started (model m1, permission mode acceptEdits).' }]);
});

test('assistant text and tool calls become readable lines, paths relative to the folder', () => {
  const { entries } = parseStreamLine(
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: '  Starting with the page.\n' },
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: path.join(folder, 'src', 'app.js'), old_string: 'a' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } },
        ],
      },
    }),
    folder,
  );
  assert.deepEqual(entries, [
    { kind: 'assistant', text: 'Starting with the page.' },
    { kind: 'tool', text: 'Edit src/app.js' },
    { kind: 'tool', text: 'Bash npm test' },
  ]);
});

test('tool one-liners for the other common tools', () => {
  assert.equal(toolLine('Write', { file_path: path.join(folder, 'README.md') }, folder), 'Write README.md');
  assert.equal(toolLine('Read', { file_path: 'C:\\elsewhere\\x.txt' }, folder), 'Read C:\\elsewhere\\x.txt');
  assert.equal(toolLine('Glob', { pattern: '**/*.js' }, folder), 'Glob **/*.js');
  assert.equal(toolLine('Grep', { pattern: 'todo', path: path.join(folder, 'src') }, folder), 'Grep "todo" in src');
  assert.equal(
    toolLine('TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }] }, folder),
    'TodoWrite 1 of 3 done',
  );
  assert.equal(toolLine('Bash', { command: 'git add -A\ngit commit -m x' }, folder), 'Bash git add -A ...');
  assert.equal(toolLine('Bash', { command: 'x'.repeat(300) }, folder).length, 'Bash '.length + 200);
  assert.equal(toolLine('SomethingNew', { thing: 'value' }, folder), 'SomethingNew value');
});

test('tool results are trimmed to a few short lines; errors are marked', () => {
  const long = Array.from({ length: 10 }, (_, i) => `line ${i} ${'y'.repeat(i === 1 ? 300 : 3)}`).join('\n');
  const { entries } = parseStreamLine(
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: long }] }] } }),
    folder,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'output');
  const shown = entries[0].text.split('\n');
  assert.equal(shown.length, 4);
  assert.match(shown[0], /^ {2}-> line 0/);
  assert.ok(shown[1].length <= 162 && shown[1].endsWith('...'));
  assert.equal(shown[3], '  (7 more lines)');

  const err = parseStreamLine(
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'command not allowed', is_error: true }] } }),
    folder,
  );
  assert.deepEqual(err.entries, [{ kind: 'error', text: '  -> command not allowed' }]);
});

test('the result event gives the summary; errors are flagged', () => {
  const ok = parseStreamLine(line({ type: 'result', subtype: 'success', is_error: false, num_turns: 7, result: 'All good.' }), folder);
  assert.deepEqual(ok.result, { text: 'All good.', isError: false, numTurns: 7 });
  assert.deepEqual(ok.entries, [{ kind: 'info', text: 'Claude finished, 7 turns.' }]);

  const bad = parseStreamLine(line({ type: 'result', subtype: 'error_max_turns', is_error: false, num_turns: 1 }), folder);
  assert.equal(bad.result.isError, true);
  assert.equal(bad.entries[0].kind, 'error');
});

test('non-JSON lines pass through; partial and unknown events are hidden', () => {
  assert.deepEqual(parseStreamLine('plain text', folder).entries, [{ kind: 'stdout', text: 'plain text' }]);
  assert.deepEqual(parseStreamLine(line({ type: 'stream_event', event: {} }), folder).entries, []);
  assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'hook_response' }), folder).entries, []);
  assert.deepEqual(parseStreamLine('   ', folder).entries, []);
});

// Flags and prompt

test('flags with the permission-skip setting on', () => {
  assert.deepEqual(buildArgs(true), ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']);
});

test('flags with it off: acceptEdits plus a short allow-list, and no skip flag', () => {
  const args = buildArgs(false);
  assert.deepEqual(args.slice(0, 6), ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits']);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  const i = args.indexOf('--allowedTools');
  assert.equal(i, 6, '--allowedTools takes a list, so it must come last');
  assert.deepEqual(args.slice(i + 1), ALLOWED_COMMANDS.map((c) => `Bash(${c} *)`));
  for (const c of ['npm', 'node', 'python', 'dotnet', 'git']) assert.ok(ALLOWED_COMMANDS.includes(c), c);
});

test('the prompt file has the request word for word, the plan and the instructions', () => {
  const request = 'A to-do list page with 100% "fun" & $& {{folder}}\nsecond line';
  const job = { request, estimate, folder, settings: settings() };
  const prompt = buildPrompt(readFileSync(PROMPT_FILE, 'utf8'), job);
  assert.ok(prompt.includes(`<request>\n${request}\n</request>`), 'request word for word, not filled in again');
  assert.ok(prompt.includes('A to-do list web page.'));
  assert.ok(prompt.includes('HTML, CSS and JavaScript'));
  assert.ok(prompt.includes('1. Write index.html\n2. Add the list logic\n3. Test it'));
  assert.ok(prompt.includes(`Work only inside this folder: ${folder}`));
  assert.match(prompt, /never ask any/);
  assert.match(prompt, /commit after each working\s+step/);
  assert.match(prompt, /back into\s+main/);
  assert.match(prompt, /worktrees/);
  assert.match(prompt, /README\.md/);
  assert.match(prompt, /tests, or a smoke run/);
  assert.match(prompt, /short summary/);
  assert.match(prompt, /## How to run/, 'the README gets a "How to run" section (the fallback)');
  assert.match(prompt, /write RUN\.json in the project root/);
  assert.match(prompt, /"kind": "static", "open": "index\.html"/);
  assert.match(prompt, /"kind": "command", "install": "npm install", "command": "npm run dev"/);
  assert.doesNotMatch(prompt.replace(request, ''), /\{\{\w+\}\}/);
  assert.match(prompt, /any command you need/);

  const limited = buildPrompt(readFileSync(PROMPT_FILE, 'utf8'), { ...job, settings: settings({ skipPermissions: false }) });
  assert.match(limited, /run only these commands: npm, npx, node, python, py, pip, dotnet and git/);
});

test('formatDuration', () => {
  assert.equal(formatDuration(4_400), '4 s');
  assert.equal(formatDuration(120_000), '2 min');
  assert.equal(formatDuration(125_000), '2 min 5 s');
});

// Whole builds with the fake CLI

async function newProject() {
  const { folder: dir } = createProjectFolder(tmp, 'proj');
  assert.deepEqual(await initRepo(dir), { ok: true });
  return dir;
}

/** runBuild with a startRun like main.ts's; the handle is kept so the test can Stop. */
function makeCtx({ env, timeoutMs, promptFile } = {}) {
  const calls = { logs: [], statuses: [], events: [], runs: [], handle: null };
  const ctx = {
    log: (kind, text) => calls.logs.push({ kind, text }),
    setStatus: (s) => calls.statuses.push(s),
    startRun: (opts) => {
      calls.runs.push(opts);
      calls.handle = runClaude(opts);
      return calls.handle.done;
    },
    onEvent: (e) => calls.events.push(e),
    timeoutMs,
    env,
    promptFile,
  };
  return { ctx, calls };
}

test('a build runs headless in the folder, logs readable lines and lists its commits', async () => {
  const dir = await newProject();
  const { ctx, calls } = makeCtx();
  const entry = await runBuild({ request: 'a to-do list web page', estimate, folder: dir, settings: settings() }, ctx);

  assert.equal(entry.result, 'done');
  assert.equal(entry.request, 'a to-do list web page');
  assert.equal(entry.folder, dir);
  assert.ok(Date.parse(entry.startedAt) <= Date.now());
  assert.match(entry.summary, /Built a README \(fake\)/);
  assert.equal(entry.hasReadme, true);
  assert.equal(entry.estimateMinutes, 12);
  assert.deepEqual(entry.commits.map((c) => c.subject), ['Add README']);
  assert.equal(entry.commits[0].hash, git(dir, 'rev-parse', '--short', 'HEAD'));
  assert.equal(git(dir, 'branch', '--show-current'), 'main', 'the prompt tells Claude to merge back into main');
  assert.match(readFileSync(path.join(dir, 'README.md'), 'utf8'), /Request: a to-do list web page/);

  const run = calls.runs[0];
  assert.equal(run.cwd, dir);
  assert.deepEqual(run.args, buildArgs(true));
  assert.equal(run.timeoutMs, 30 * 60_000, 'the cap from settings');
  assert.match(run.stdin, /software2 build request/);

  const texts = calls.logs.map((l) => `${l.kind}: ${l.text}`);
  assert.ok(texts.includes('info: Claude started (model fake-claude, permission mode bypassPermissions).'), texts.join('\n'));
  assert.ok(texts.includes('tool: Write README.md'));
  assert.ok(texts.includes('tool: Bash git add -A && git commit -m "Add README"'));
  assert.ok(texts.some((t) => t.startsWith('output:   -> File created successfully')));
  assert.ok(texts.includes('assistant: I will write a README and commit it.'));
  assert.ok(!calls.logs.some((l) => l.kind === 'stdout'), 'no raw JSON in the log');

  assert.deepEqual(calls.events.map((e) => e.type), ['started', 'ended']);
  assert.equal(calls.events[0].estimateMinutes, 12);
  assert.equal(calls.events[0].capMinutes, 30);
  assert.deepEqual(calls.events[1].outcome, entry);
  assert.equal(calls.statuses.at(-1), 'Build done');
});

test('with the permission-skip setting off the run gets acceptEdits and the allow-list', async () => {
  const dir = await newProject();
  const { ctx, calls } = makeCtx();
  const entry = await runBuild({ request: 'x', estimate, folder: dir, settings: settings({ skipPermissions: false }) }, ctx);
  assert.equal(entry.result, 'done');
  assert.deepEqual(calls.runs[0].args, buildArgs(false));
  assert.ok(calls.logs.some((l) => l.text === 'Claude started (model fake-claude, permission mode acceptEdits).'));
  assert.ok(calls.logs.some((l) => /others fail without a prompt/.test(l.text)));
});

test('Stop kills the build and ends it as stopped', async () => {
  const dir = await newProject();
  const { ctx, calls } = makeCtx({ env: { FAKE_CLAUDE_MODE: 'hang' } });
  const pending = runBuild({ request: 'x', estimate, folder: dir, settings: settings() }, ctx);
  await new Promise((r) => setTimeout(r, 500));
  calls.handle.stop();
  const entry = await pending;
  assert.equal(entry.result, 'stopped');
  assert.match(entry.summary, /^Stopped after \d+ s\./);
  assert.deepEqual(entry.commits, []);
  assert.equal(calls.statuses.at(-1), 'Build stopped');
});

test('the time cap ends the build as timed out', async () => {
  const dir = await newProject();
  const { ctx } = makeCtx({ env: { FAKE_CLAUDE_MODE: 'hang' }, timeoutMs: 400 });
  const started = Date.now();
  const entry = await runBuild({ request: 'x', estimate, folder: dir, settings: settings({ buildCapMinutes: 7 }) }, ctx);
  assert.equal(entry.result, 'timed out');
  assert.match(entry.summary, /7 min time cap ran out/);
  assert.ok(Date.now() - started < 10_000);
});

test('a CLI that fails ends the build as failed, with its error in the summary', async () => {
  const dir = await newProject();
  const { ctx, calls } = makeCtx({ env: { FAKE_CLAUDE_MODE: 'fail' } });
  const entry = await runBuild({ request: 'x', estimate, folder: dir, settings: settings() }, ctx);
  assert.equal(entry.result, 'failed');
  assert.match(entry.summary, /exit code 1/);
  assert.match(entry.summary, /something went wrong/);
  assert.equal(entry.hasReadme, false);
  assert.deepEqual(calls.events.at(-1), { type: 'ended', outcome: entry });
});

test('a missing CLI or prompt file fails without running anything', async () => {
  const dir = await newProject();
  const missing = makeCtx();
  const entry = await runBuild({ request: 'x', estimate, folder: dir, settings: settings({ claudePath: path.join(tmp, 'nope.exe') }) }, missing.ctx);
  assert.equal(entry.result, 'failed');
  assert.match(entry.summary, /not found/);

  const noPrompt = makeCtx({ promptFile: path.join(tmp, 'no-such-prompt.md') });
  const entry2 = await runBuild({ request: 'x', estimate, folder: dir, settings: settings() }, noPrompt.ctx);
  assert.equal(entry2.result, 'failed');
  assert.match(entry2.summary, /build prompt/);
  assert.equal(noPrompt.calls.runs.length, 0);
  assert.equal(noPrompt.calls.events.at(-1).outcome, entry2);
});
