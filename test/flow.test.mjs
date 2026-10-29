// Flow and project-folder tests: Go -> estimate -> confirm/cancel -> folder -> build,
// with test/fake-claude.mjs as the CLI and stand-ins for the Electron dialogs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Flow } from '../dist/main/flow.js';
import { checkEmptyFolder, prepareProjectFolder } from '../dist/main/project.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-flow-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let n = 0;
const newDir = () => path.join(tmp, `p${++n}`);

/** A Flow with recorded stand-ins. picks: what each folder dialog returns, in order. */
function makeFlow({ picks = [], env } = {}) {
  const calls = { picked: [], refused: [], builds: [], logs: [], statuses: [] };
  const flow = new Flow({
    settings: () => ({ claudePath: FAKE, projectsFolder: tmp, buildCapMinutes: 30, skipPermissions: true }),
    log: (kind, text) => calls.logs.push({ kind, text }),
    setStatus: (s) => calls.statuses.push(s),
    pickFolder: async (defaultPath) => {
      calls.picked.push(defaultPath);
      return picks.shift() ?? null;
    },
    refuseFolder: async (message) => {
      calls.refused.push(message);
    },
    build: async (job) => {
      calls.builds.push(job);
    },
    env,
  });
  return { flow, calls };
}

// The project folder

test('a non-empty folder is refused with a clear message', () => {
  const dir = newDir();
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'notes.txt'), 'hi');
  const res = checkEmptyFolder(dir);
  assert.equal(res.ok, false);
  assert.match(res.error, /not empty/);
  assert.match(res.error, /notes\.txt/);
  assert.match(res.error, /new, empty folder/);
});

test('an empty folder becomes a git repo with one empty commit and a clean tree', async () => {
  const dir = newDir();
  mkdirSync(dir);
  assert.deepEqual(await prepareProjectFolder(dir), { ok: true });
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'ls-tree', '-r', 'HEAD'), '');
  assert.deepEqual(readdirSync(dir), ['.git']);
});

test('a folder that does not exist yet is created', async () => {
  const dir = path.join(newDir(), 'nested', 'app');
  assert.deepEqual(await prepareProjectFolder(dir), { ok: true });
  assert.ok(existsSync(path.join(dir, '.git')));
});

test('a non-empty folder is not touched', async () => {
  const dir = newDir();
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'keep.txt'), 'x');
  assert.equal((await prepareProjectFolder(dir)).ok, false);
  assert.deepEqual(readdirSync(dir), ['keep.txt']);
});

// The whole flow

test('estimate, then Cancel: no folder dialog, no build, ready again', async () => {
  const { flow, calls } = makeFlow();
  const outcome = await flow.estimate('a todo app');
  assert.equal(outcome.status, 'ok');
  assert.ok(calls.statuses.includes('Estimating...'));
  flow.cancel();
  assert.equal(calls.picked.length, 0);
  assert.equal(calls.builds.length, 0);
  assert.equal(calls.statuses.at(-1), 'Ready');
  // Build it after Cancel does nothing.
  assert.equal((await flow.confirm()).status, 'error');
  assert.equal(calls.picked.length, 0);
  // And Go works again.
  assert.equal((await flow.estimate('another one')).status, 'ok');
});

test('Build it: a non-empty pick is refused, then an empty one is set up and handed to the build', async () => {
  const full = newDir();
  mkdirSync(full);
  writeFileSync(path.join(full, 'old.txt'), 'x');
  const empty = newDir();
  mkdirSync(empty);
  const { flow, calls } = makeFlow({ picks: [full, empty] });

  const est = await flow.estimate('  a todo app ');
  assert.equal(est.status, 'ok');
  const res = await flow.confirm();
  assert.deepEqual(res, { status: 'built', folder: empty });

  assert.deepEqual(calls.picked, [tmp, tmp], 'the dialog opens at the default folder each time');
  assert.equal(calls.refused.length, 1);
  assert.match(calls.refused[0], /not empty/);
  assert.deepEqual(readdirSync(full), ['old.txt']);

  assert.equal(calls.builds.length, 1);
  const job = calls.builds[0];
  assert.equal(job.request, 'Build me a todo app', 'the box reads "build me [ ... ]"');
  assert.deepEqual(job.estimate, est.estimate);
  assert.equal(job.folder, empty);
  assert.equal(job.settings.buildCapMinutes, 30);
  assert.equal(git(empty, 'rev-list', '--count', 'HEAD'), '1');
  assert.ok(calls.statuses.includes('Building...'));
  assert.equal(calls.statuses.at(-1), 'Ready');
});

test('closing the folder dialog cancels without building', async () => {
  const { flow, calls } = makeFlow({ picks: [] });
  await flow.estimate('a todo app');
  assert.deepEqual(await flow.confirm(), { status: 'cancelled' });
  assert.equal(calls.builds.length, 0);
  assert.equal(calls.statuses.at(-1), 'Ready');
});

test('Stop during the estimate cancels it', async () => {
  const { flow, calls } = makeFlow({ env: { FAKE_CLAUDE_MODE: 'hang' } });
  const pending = flow.estimate('a todo app');
  assert.equal(flow.busy, true);
  assert.equal((await flow.estimate('again')).status, 'error', 'only one estimate at a time');
  setTimeout(() => flow.stop(), 300);
  assert.equal((await pending).status, 'stopped');
  assert.equal(flow.busy, false);
  assert.equal(calls.statuses.at(-1), 'Cancelled');
});

test('an unreadable estimate does not reach the confirm step', async () => {
  const { flow, calls } = makeFlow({ env: { FAKE_CLAUDE_RESULT: 'about 20 minutes' } });
  const outcome = await flow.estimate('a todo app');
  assert.equal(outcome.status, 'unreadable');
  assert.equal(outcome.raw, 'about 20 minutes');
  assert.equal((await flow.confirm()).status, 'error');
  assert.equal(calls.picked.length, 0);
});

test('an empty request is refused without running anything', async () => {
  const { flow, calls } = makeFlow();
  assert.equal((await flow.estimate('   ')).status, 'error');
  assert.equal(calls.statuses.length, 0);
});
