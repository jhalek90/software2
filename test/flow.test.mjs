// Flow and project-folder tests: Go -> estimate -> confirm/cancel -> new folder -> build,
// with test/fake-claude.mjs as the CLI. Nobody picks a folder: the flow names it and makes
// it in the projects folder from Settings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Flow } from '../dist/main/flow.js';
import { createProjectFolder, initRepo, plannedFolder } from '../dist/main/project.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-flow-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let n = 0;
const newDir = () => path.join(tmp, `p${++n}`);
/** A plain file where a folder would go. */
const aFile = () => {
  const file = `${newDir()}.txt`;
  writeFileSync(file, 'x');
  return file;
};

/** A Flow with recorded stand-ins, its projects going into projectsFolder (default: a new
 *  one that does not exist yet). The folder dialogs the app used to open are spies here,
 *  so a test can tell that nothing asks for them. */
function makeFlow({ env, projectsFolder = newDir() } = {}) {
  const calls = { dialogs: [], builds: [], logs: [], statuses: [] };
  const flow = new Flow({
    settings: () => ({ claudePath: FAKE, projectsFolder, buildCapMinutes: 30, skipPermissions: true }),
    log: (kind, text) => calls.logs.push({ kind, text }),
    setStatus: (s) => calls.statuses.push(s),
    pickFolder: async (...args) => {
      calls.dialogs.push(['pickFolder', ...args]);
      return null;
    },
    refuseFolder: async (...args) => {
      calls.dialogs.push(['refuseFolder', ...args]);
    },
    build: async (job) => {
      calls.builds.push(job);
    },
    env,
  });
  return { flow, calls, projectsFolder };
}

// The project folder

test('a new project folder is made in the projects folder, which is made too when missing', () => {
  const parent = path.join(newDir(), 'nested', 'projects');
  const res = createProjectFolder(parent, 'todo-app');
  assert.deepEqual(res, { ok: true, folder: path.join(parent, 'todo-app') });
  assert.deepEqual(readdirSync(res.folder), []);
});

test('a taken name gets -2, -3, ...; existing folders and files are never reused or touched', () => {
  const parent = newDir();
  mkdirSync(path.join(parent, 'todo-app'), { recursive: true });
  writeFileSync(path.join(parent, 'todo-app', 'keep.txt'), 'x');
  mkdirSync(path.join(parent, 'todo-app-2')); // empty, and still not reused
  writeFileSync(path.join(parent, 'todo-app-3'), 'a file, not a folder');
  assert.equal(plannedFolder(parent, 'todo-app'), path.join(parent, 'todo-app-4'));
  assert.deepEqual(createProjectFolder(parent, 'todo-app'), { ok: true, folder: path.join(parent, 'todo-app-4') });
  assert.deepEqual(createProjectFolder(parent, 'todo-app'), { ok: true, folder: path.join(parent, 'todo-app-5') });
  assert.deepEqual(readdirSync(path.join(parent, 'todo-app')), ['keep.txt']);
  assert.deepEqual(readdirSync(path.join(parent, 'todo-app-2')), []);
  // Names differing only in case are the same folder on Windows.
  mkdirSync(path.join(parent, 'Clock'));
  assert.equal(createProjectFolder(parent, 'clock').folder, path.join(parent, 'clock-2'));
});

test('a numbered name stays within 40 characters', () => {
  const parent = newDir();
  const long = 'a-forty-character-project-name-is-long-x';
  assert.equal(long.length, 40);
  assert.equal(createProjectFolder(parent, long).folder, path.join(parent, long));
  const second = path.basename(createProjectFolder(parent, long).folder);
  assert.equal(second, 'a-forty-character-project-name-is-long-2');
});

test('a projects folder that cannot be made is a clear error', () => {
  const res = createProjectFolder(path.join(aFile(), 'projects'), 'app');
  assert.equal(res.ok, false);
  assert.match(res.error, /Could not create/);
});

test('a new folder becomes a git repo with one empty commit and a clean tree', async () => {
  const { folder } = createProjectFolder(newDir(), 'app');
  assert.deepEqual(await initRepo(folder), { ok: true });
  assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(folder, 'branch', '--show-current'), 'main');
  assert.equal(git(folder, 'status', '--porcelain'), '');
  assert.equal(git(folder, 'ls-tree', '-r', 'HEAD'), '');
  assert.deepEqual(readdirSync(folder), ['.git']);
});

// The whole flow

test('estimate, then Cancel: no folder made, no build, ready again', async () => {
  const { flow, calls, projectsFolder } = makeFlow();
  const outcome = await flow.estimate('a todo app');
  assert.equal(outcome.status, 'ok');
  assert.ok(calls.statuses.includes('Estimating...'));
  flow.cancel();
  assert.ok(!existsSync(projectsFolder), 'nothing is made before Build it');
  assert.equal(calls.builds.length, 0);
  assert.equal(calls.statuses.at(-1), 'Ready');
  // Build it after Cancel does nothing.
  assert.equal((await flow.confirm()).status, 'error');
  assert.ok(!existsSync(projectsFolder));
  // And Go works again.
  assert.equal((await flow.estimate('another one')).status, 'ok');
  assert.deepEqual(calls.dialogs, []);
});

test('the name comes from the estimate; Build it makes that folder, git inits it and builds, with no dialog', async () => {
  const { flow, calls, projectsFolder } = makeFlow({ env: { FAKE_CLAUDE_NAME: 'pixel-art-editor' } });
  const est = await flow.estimate('  a tool for drawing sprites ');
  assert.equal(est.status, 'ok');
  assert.equal(est.estimate.name, 'pixel-art-editor');
  const expected = path.join(projectsFolder, 'pixel-art-editor');
  assert.equal(est.folder, expected, 'the confirm card says where it will be created');
  assert.ok(!existsSync(projectsFolder), 'the estimate only plans the folder');

  const res = await flow.confirm();
  assert.deepEqual(res, { status: 'built', folder: expected });
  assert.deepEqual(calls.dialogs, [], 'no folder dialog is opened');
  assert.ok(calls.statuses.includes('Creating the project folder'));

  assert.equal(calls.builds.length, 1);
  const job = calls.builds[0];
  assert.equal(job.request, 'Build me a tool for drawing sprites', 'the box reads "build me [ ... ]"');
  assert.deepEqual(job.estimate, est.estimate);
  assert.equal(job.folder, expected);
  assert.equal(job.settings.buildCapMinutes, 30);
  assert.equal(git(expected, 'rev-list', '--count', 'HEAD'), '1');
  assert.ok(calls.statuses.includes('Building...'));
  assert.equal(calls.statuses.at(-1), 'Ready');
  assert.ok(calls.logs.some((l) => l.text.startsWith('Project name: pixel-art-editor.')));
});

test('without a name in the estimate, it comes from the request', async () => {
  const { flow, calls, projectsFolder } = makeFlow();
  const est = await flow.estimate('a pomodoro timer with a big start button');
  assert.equal(est.estimate.name, 'pomodoro-timer');
  assert.equal(est.folder, path.join(projectsFolder, 'pomodoro-timer'));
  assert.ok(calls.logs.some((l) => /Project name: pomodoro-timer \(from the request/.test(l.text)));
  assert.equal((await flow.confirm()).folder, path.join(projectsFolder, 'pomodoro-timer'));
});

test('an unusable name from the estimate falls back to the request', async () => {
  for (const bad of ['CON', '日本語', '   ', '...']) {
    const { flow } = makeFlow({ env: { FAKE_CLAUDE_NAME: bad } });
    const est = await flow.estimate('a snake game');
    assert.equal(est.estimate.name, 'snake-game', bad);
  }
  // A name that only needs cleaning is cleaned, not replaced.
  const { flow } = makeFlow({ env: { FAKE_CLAUDE_NAME: 'Gun Blocks!' } });
  assert.equal((await flow.estimate('a block shooter')).estimate.name, 'gun-blocks');
});

test('a taken name gets -2, then -3, in the flow too, and the card says so beforehand', async () => {
  const projectsFolder = newDir();
  for (const expected of ['snake-game', 'snake-game-2', 'snake-game-3']) {
    const { flow } = makeFlow({ projectsFolder });
    const est = await flow.estimate('a snake game');
    assert.equal(est.folder, path.join(projectsFolder, expected));
    assert.equal((await flow.confirm()).folder, path.join(projectsFolder, expected));
  }
  // Taken between the estimate and Build it: the next free one is used.
  const { flow, calls } = makeFlow({ projectsFolder });
  const est = await flow.estimate('a snake game');
  mkdirSync(est.folder);
  const res = await flow.confirm();
  assert.equal(res.folder, path.join(projectsFolder, 'snake-game-5'));
  assert.equal(calls.builds[0].folder, res.folder);
  assert.deepEqual(readdirSync(est.folder), [], 'the folder made in between is left alone');
});

test('a projects folder that cannot be made: no build, the error is reported', async () => {
  const { flow, calls } = makeFlow({ projectsFolder: path.join(aFile(), 'projects') });
  await flow.estimate('a todo app');
  const res = await flow.confirm();
  assert.equal(res.status, 'error');
  assert.match(res.error, /Could not create/);
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
  assert.equal(calls.builds.length, 0);
});

test('an empty request is refused without running anything', async () => {
  const { flow, calls } = makeFlow();
  assert.equal((await flow.estimate('   ')).status, 'error');
  assert.equal(calls.statuses.length, 0);
});
