// Estimate tests: parsing the reply, and the estimate run against test/fake-claude.mjs
// (never the real claude CLI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ESTIMATE_ARGS,
  ESTIMATE_TIMEOUT_MS,
  estimatePrompt,
  parseEstimate,
  readCliReply,
  startEstimate,
} from '../dist/main/estimate.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-estimate-test-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const GOOD = {
  minutes: 25,
  name: 'todo-app',
  summary: 'A todo app in the browser.',
  stack: 'TypeScript + Vite',
  steps: ['Scaffold', 'Build the list', 'Save to localStorage'],
  risks: ['None really'],
};

// Parsing

test('parses clean JSON', () => {
  const res = parseEstimate(JSON.stringify(GOOD));
  assert.equal(res.ok, true);
  assert.deepEqual(res.estimate, GOOD);
});

test('parses JSON in a code fence', () => {
  const res = parseEstimate('```json\n' + JSON.stringify(GOOD, null, 2) + '\n```');
  assert.equal(res.ok, true);
  assert.deepEqual(res.estimate, GOOD);
});

test('parses a fence without a language, with prose around it', () => {
  const res = parseEstimate('Sure! Here it is:\n```\n' + JSON.stringify(GOOD) + '\n```\nHope that helps.');
  assert.equal(res.ok, true);
  assert.equal(res.estimate.minutes, 25);
});

test('finds the JSON object in prose, with braces inside strings', () => {
  const tricky = { ...GOOD, summary: 'Prints {hello} and "quotes" \\ ok' };
  const res = parseEstimate(`My estimate {roughly}: ${JSON.stringify(tricky)} -- done.`);
  assert.equal(res.ok, true);
  assert.equal(res.estimate.summary, tricky.summary);
});

test('broken JSON fails with a message', () => {
  const res = parseEstimate('{"minutes": 20, "summary": "A todo app", "steps": ["a",');
  assert.equal(res.ok, false);
  assert.match(res.error, /not JSON/);
});

test('plain text fails', () => {
  const res = parseEstimate('I think this would take about twenty minutes.');
  assert.equal(res.ok, false);
});

test('JSON without minutes or summary fails and says what is missing', () => {
  assert.match(parseEstimate('{"summary": "x"}').error, /minutes/);
  assert.match(parseEstimate('{"minutes": 5}').error, /summary/);
  assert.match(parseEstimate('{"minutes": 0, "summary": "x"}').error, /minutes/);
});

test('is lenient about types and trims the lists', () => {
  const res = parseEstimate(
    JSON.stringify({
      minutes: '12.4',
      summary: '  A thing.  ',
      steps: ['1', '2', '3', '4', '5', '6', '7', 8, ''],
      risks: 'One risk',
    }),
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.estimate, {
    minutes: 12,
    name: '',
    summary: 'A thing.',
    stack: '',
    steps: ['1', '2', '3', '4', '5', '6'],
    risks: ['One risk'],
  });
  const four = parseEstimate(JSON.stringify({ ...GOOD, risks: ['a', 'b', 'c', 'd'] }));
  assert.deepEqual(four.estimate.risks, ['a', 'b', 'c']);
});

test('the folder name is made safe, and left empty when the reply has none usable', () => {
  const name = (n) => parseEstimate(JSON.stringify({ ...GOOD, name: n })).estimate.name;
  assert.equal(name('Pixel Art Editor!'), 'pixel-art-editor');
  assert.equal(name('gunblocks'), 'gunblocks');
  assert.equal(name('CON'), '');
  assert.equal(name('???'), '');
  assert.equal(name(42), '');
  const { name: _, ...noName } = GOOD;
  assert.equal(parseEstimate(JSON.stringify(noName)).estimate.name, '');
});

test('the prompt asks for a kebab-case folder name', () => {
  const prompt = estimatePrompt('Build me a todo app');
  assert.match(prompt, /"name": "project-name"/);
  assert.match(prompt, /1 to 4 words in lowercase kebab-case/);
});

test('reads the result text out of --output-format json output', () => {
  const line = JSON.stringify({ type: 'result', is_error: false, result: '{"minutes":3}' });
  assert.deepEqual(readCliReply(line + '\n'), { text: '{"minutes":3}', isError: false });
  const err = JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' });
  assert.deepEqual(readCliReply(err), { text: 'Not logged in', isError: true });
  assert.deepEqual(readCliReply('just text'), { text: 'just text', isError: false });
});

test('the prompt carries the request and asks for JSON only', () => {
  const p = estimatePrompt('  a snake game  ');
  assert.match(p, /<request>\na snake game\n<\/request>/);
  assert.match(p, /JSON/);
  assert.match(p, /"minutes": number/);
});

// Running against the fake CLI

function estimate(opts = {}) {
  const stdout = [];
  const handle = startEstimate({
    cliPath: FAKE,
    request: 'a todo app',
    tmpParent: tmp,
    ...opts,
    onStdout: (line) => {
      stdout.push(line);
      opts.onStdout?.(line, handle);
    },
  });
  return { handle, stdout };
}

test('runs headless with no tools in a temporary empty folder, removed afterwards', async () => {
  const { handle, stdout } = estimate();
  const outcome = await handle.done;
  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.estimate.minutes, 2);

  const { fake } = JSON.parse(stdout.at(-1));
  assert.deepEqual(fake.args, ESTIMATE_ARGS);
  assert.ok(fake.args.includes('-p'));
  assert.equal(fake.args[fake.args.indexOf('--tools') + 1], '');
  assert.ok(fake.args.includes('--strict-mcp-config'));
  assert.equal(path.dirname(fake.cwd), tmp);
  assert.ok(path.basename(fake.cwd).startsWith('software2-estimate-'));
  assert.ok(!existsSync(fake.cwd), 'the temporary folder is still there');
  assert.deepEqual(readdirSync(tmp), []);
});

test('a fenced reply from the CLI parses', async () => {
  const fenced = '```json\n' + JSON.stringify(GOOD) + '\n```';
  const outcome = await estimate({ env: { FAKE_CLAUDE_RESULT: fenced } }).handle.done;
  assert.equal(outcome.status, 'ok');
  assert.deepEqual(outcome.estimate, GOOD);
});

test('a broken reply comes back unreadable, with the raw text to show', async () => {
  const broken = '{"minutes": 20, "summary": "oops';
  const outcome = await estimate({ env: { FAKE_CLAUDE_RESULT: broken } }).handle.done;
  assert.equal(outcome.status, 'unreadable');
  assert.equal(outcome.raw, broken);
  assert.ok(outcome.error);
});

test('the cap is 60 s by default', () => {
  assert.equal(ESTIMATE_TIMEOUT_MS, 60_000);
});

test('the cap stops an estimate that takes too long', async () => {
  const outcome = await estimate({ env: { FAKE_CLAUDE_MODE: 'hang' }, timeoutMs: 600 }).handle.done;
  assert.equal(outcome.status, 'timeout');
  assert.match(outcome.error, /longer than 1 s/);
  assert.deepEqual(readdirSync(tmp), []);
});

test('stop() cancels a running estimate', async () => {
  const started = Date.now();
  const { handle } = estimate({ env: { FAKE_CLAUDE_MODE: 'hang' }, onStdout: (_l, h) => h.stop() });
  const outcome = await handle.done;
  assert.equal(outcome.status, 'stopped');
  assert.ok(Date.now() - started < 10_000);
});

test('a failing CLI gives an error with what it said', async () => {
  const outcome = await estimate({ env: { FAKE_CLAUDE_MODE: 'fail', FAKE_CLAUDE_EXIT_CODE: '2' } }).handle.done;
  assert.equal(outcome.status, 'error');
  assert.match(outcome.error, /exit code 2/);
  assert.match(outcome.raw, /something went wrong/);
});

test('a missing CLI gives an error', async () => {
  const outcome = await estimate({ cliPath: path.join(tmp, 'nope.exe') }).handle.done;
  assert.equal(outcome.status, 'error');
  assert.match(outcome.error, /not found/);
});

test('the empty --tools argument survives a .cmd shim', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'software2-shim '));
  try {
    const shim = path.join(dir, 'claude.cmd');
    writeFileSync(shim, `@"${process.execPath}" "${FAKE}" %*\r\n`);
    const { handle, stdout } = estimate({ cliPath: shim });
    assert.equal((await handle.done).status, 'ok');
    assert.deepEqual(JSON.parse(stdout.at(-1)).fake.args, ESTIMATE_ARGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
