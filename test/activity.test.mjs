// The live status line: the one-sentence activity derived from the stream, the build's
// onActivity calls with the fake CLI, and the full log file kept per run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../dist/main/build.js';
import { loadHistory } from '../dist/main/history.js';
import { prepareProjectFolder } from '../dist/main/project.js';
import { runClaude } from '../dist/main/runner.js';
import { LOGS_DIR, LOGS_MAX, RunLog } from '../dist/main/runlog.js';
import { parseStreamLine, textActivity, toolActivity } from '../dist/main/stream.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-activity-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const folder = path.join(tmp, 'proj');
const line = (obj) => JSON.stringify(obj);

test('tool calls become short plain sentences, paths relative to the folder', () => {
  const a = (name, input) => toolActivity(name, input, folder);
  assert.equal(a('Write', { file_path: path.join(folder, 'src', 'app.js') }), 'Writing src/app.js');
  assert.equal(a('Edit', { file_path: path.join(folder, 'index.html') }), 'Editing index.html');
  assert.equal(a('MultiEdit', { file_path: path.join(folder, 'a.css') }), 'Editing a.css');
  assert.equal(a('Read', { file_path: path.join(folder, 'package.json') }), 'Reading package.json');
  assert.equal(a('Bash', { command: 'npm test' }), 'Running npm test');
  assert.equal(a('PowerShell', { command: 'npm install\nnpm test' }), 'Running npm install...');
  assert.equal(a('Bash', { command: 'git add -A && git commit -m "Add the list logic"' }), 'Committing: Add the list logic');
  assert.equal(a('Bash', { command: "git commit -am 'Fix the layout'" }), 'Committing: Fix the layout');
  assert.equal(a('Bash', { command: 'git -c user.name=x commit -m "Say \\"hi\\""' }), 'Committing: Say "hi"');
  assert.equal(a('Bash', { command: 'git commit' }), 'Committing');
  assert.equal(a('Glob', { pattern: '**/*.js' }), 'Looking for **/*.js');
  assert.equal(a('TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }), 'Planning: 1 of 2 steps done');
  assert.equal(a('SomethingNew', { x: 1 }), 'Using SomethingNew');
});

test('long activities are cut to one line with an ellipsis', () => {
  const text = toolActivity('Bash', { command: `echo ${'x'.repeat(300)}` }, folder);
  assert.ok(text.length <= 90, text);
  assert.ok(text.endsWith('...'));
  assert.ok(!text.includes('\n'));
});

test("Claude's text becomes its first short sentence, or Thinking...", () => {
  assert.equal(textActivity('I will write a README and commit it.'), 'I will write a README and commit it.');
  assert.equal(textActivity('Now the tests. They should cover the list.'), 'Now the tests.');
  assert.equal(textActivity('## **Plan**\nfirst this'), 'Plan');
  assert.equal(textActivity("Here's what I'll do:\n1. a"), "Here's what I'll do...");
  assert.equal(textActivity('x'.repeat(200)), 'Thinking...');
});

test('a stream line carries the activity of its last block; results and init too', () => {
  const ev = line({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Starting with the page.' },
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: path.join(folder, 'index.html') } },
      ],
    },
  });
  assert.equal(parseStreamLine(ev, folder).activity, 'Writing index.html');
  const thinking = line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } });
  assert.equal(parseStreamLine(thinking, folder).activity, 'Thinking...');
  assert.equal(parseStreamLine(line({ type: 'system', subtype: 'init' }), folder).activity, 'Getting started...');
  const result = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });
  assert.equal(parseStreamLine(result, folder).activity, undefined, 'tool results do not change the line');
});

test('a build reports what it is doing and keeps its log file in the history entry', async () => {
  const dir = path.join(tmp, 'build1');
  assert.deepEqual(await prepareProjectFolder(dir), { ok: true });
  const historyDir = path.join(tmp, 'hist1');
  const activities = [];
  const runLog = new RunLog(historyDir);
  const entry = await runBuild(
    {
      request: 'x',
      estimate: { minutes: 1, summary: 's', stack: '', steps: [], risks: [] },
      folder: dir,
      settings: { claudePath: FAKE, projectsFolder: tmp, buildCapMinutes: 30, skipPermissions: true },
    },
    {
      log: (kind, text) => runLog.write(kind, text),
      setStatus: () => {},
      startRun: (opts) => runClaude(opts).done,
      historyDir,
      onActivity: (text) => activities.push(text),
      logFile: runLog.file,
    },
  );
  assert.equal(entry.result, 'done');
  assert.deepEqual(activities.slice(0, 5), [
    'Starting Claude...',
    'Getting started...',
    'Writing README.md',
    'Committing: Add README',
    'Built a README (fake).',
  ]);
  assert.equal(entry.logFile, runLog.file);
  assert.equal(loadHistory(historyDir)[0].logFile, runLog.file);
  const text = readFileSync(runLog.file, 'utf8');
  assert.match(text, /tool +Write README\.md/);
  assert.match(text, /Build done after/);
});

test('the run log writes one line per entry, indents long ones and keeps only the newest files', () => {
  const dir = path.join(tmp, 'logs1');
  const logs = path.join(dir, LOGS_DIR);
  mkdirSync(logs, { recursive: true });
  for (let i = 0; i < LOGS_MAX + 5; i++) writeFileSync(path.join(logs, `run-2000-01-01T00-00-${String(i).padStart(3, '0')}.log`), '');
  writeFileSync(path.join(logs, 'keep-me.txt'), '');

  const log = new RunLog(dir);
  log.write('output', 'first\nsecond');
  const lines = readFileSync(log.file, 'utf8').trimEnd().split('\n');
  assert.match(lines[0], /^\d\d:\d\d:\d\d info +software2 run started/);
  assert.match(lines[1], /^\d\d:\d\d:\d\d output +first$/);
  assert.match(lines[2], /^ {19}second$/);

  const files = readdirSync(logs).filter((f) => f.startsWith('run-'));
  assert.equal(files.length, LOGS_MAX);
  assert.ok(files.includes(path.basename(log.file)));
  assert.ok(!files.includes('run-2000-01-01T00-00-000.log'), 'the oldest went first');
  assert.ok(existsSync(path.join(logs, 'keep-me.txt')), 'other files are left alone');
});
