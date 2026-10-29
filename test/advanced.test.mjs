// The "build me" request and the Advanced panel's options: the run-time cap, the design
// style in both prompts, the files copied into assets/ (names, clashes, the size cap) and
// the estimate only hearing their names. test/fake-claude.mjs plays the CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_TOTAL_BYTES,
  checkOptions,
  clampRunTime,
  copyIntoAssets,
  fileType,
  formatSize,
  inspectFiles,
  uniqueName,
} from '../dist/main/advanced.js';
import { PROMPT_FILE, buildPrompt, runBuild } from '../dist/main/build.js';
import { estimatePrompt } from '../dist/main/estimate.js';
import { Flow, buildMeRequest } from '../dist/main/flow.js';
import { prepareProjectFolder } from '../dist/main/project.js';
import { runClaude } from '../dist/main/runner.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-advanced-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let n = 0;
const newDir = (name = 'd') => {
  const dir = path.join(tmp, `${name}${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
/** Writes a file with the given text in a new folder; returns its path. */
const sourceFile = (name, text = `contents of ${name}`) => {
  const p = path.join(newDir('src'), name);
  writeFileSync(p, text);
  return p;
};

const settings = (over = {}) => ({ claudePath: FAKE, projectsFolder: tmp, buildCapMinutes: 30, skipPermissions: true, ...over });
const estimate = { minutes: 3, summary: 'A cat website.', stack: 'HTML', steps: ['Write index.html'], risks: [] };

/** A Flow with recorded stand-ins: the folder dialog returns picks in order. */
function makeFlow({ picks = [], env } = {}) {
  const calls = { builds: [], logs: [], statuses: [] };
  const flow = new Flow({
    settings: () => settings(),
    log: (kind, text) => calls.logs.push({ kind, text }),
    setStatus: (s) => calls.statuses.push(s),
    pickFolder: async () => picks.shift() ?? null,
    refuseFolder: async () => {},
    build: async (job) => {
      calls.builds.push(job);
    },
    env,
  });
  return { flow, calls };
}

// "build me [ ... ]"

test('the request is "Build me " and what was typed, without a doubled "build me"', () => {
  assert.equal(buildMeRequest('a pomodoro timer'), 'Build me a pomodoro timer');
  assert.equal(buildMeRequest('  a to-do list web page \n'), 'Build me a to-do list web page');
  assert.equal(buildMeRequest('build me a snake game'), 'Build me a snake game');
  assert.equal(buildMeRequest('Build me: a clock'), 'Build me a clock');
  assert.equal(buildMeRequest('build meteor tracker'), 'Build me build meteor tracker', 'only the whole words');
  assert.equal(buildMeRequest('   '), '');
  assert.equal(buildMeRequest('build me'), '');
});

test('the flow sends "Build me ..." to the estimate and to the build', async () => {
  const promptFile = path.join(newDir('prompt'), 'estimate.txt');
  const { flow, calls } = makeFlow({ picks: [newDir('proj')], env: { FAKE_CLAUDE_PROMPT_FILE: promptFile } });
  assert.equal((await flow.estimate('a pomodoro timer')).status, 'ok');
  assert.match(readFileSync(promptFile, 'utf8'), /<request>\nBuild me a pomodoro timer\n<\/request>/);
  assert.ok(calls.logs.some((l) => l.text === 'Request: Build me a pomodoro timer'));
  await flow.confirm();
  assert.equal(calls.builds[0].request, 'Build me a pomodoro timer');
});

// Max run time

test('the run time is kept between 5 and 120 minutes; empty means Settings', () => {
  assert.equal(clampRunTime(45), 45);
  assert.equal(clampRunTime('45'), 45);
  assert.equal(clampRunTime(2), 5);
  assert.equal(clampRunTime(500), 120);
  assert.equal(clampRunTime(44.6), 45);
  for (const unset of [null, undefined, '', 0, -3, 'abc']) assert.equal(clampRunTime(unset), undefined, String(unset));
});

test('the run time from Advanced reaches the build, and the build is capped by it', async () => {
  const folder = newDir('proj');
  const { flow, calls } = makeFlow({ picks: [folder] });
  await flow.estimate('a timer', { capMinutes: 45 });
  await flow.confirm();
  assert.equal(calls.builds[0].capMinutes, 45);
  assert.equal(calls.builds[0].settings.buildCapMinutes, 30, 'Settings are left alone');

  // The build run itself: its time cap, the started event and the log use 45.
  const runs = [];
  const events = [];
  const logs = [];
  const entry = await runBuild(
    { request: 'Build me a timer', estimate, folder, settings: settings(), capMinutes: 45 },
    {
      log: (kind, text) => logs.push(text),
      setStatus: () => {},
      startRun: (opts) => {
        runs.push(opts);
        return runClaude(opts).done;
      },
      onEvent: (e) => events.push(e),
    },
  );
  assert.equal(entry.result, 'done');
  assert.equal(runs[0].timeoutMs, 45 * 60_000);
  assert.equal(events[0].capMinutes, 45);
  assert.ok(logs.includes(`Building in ${folder}. Time cap: 45 min (set for this run).`));
});

test('without a run time the build keeps the cap from Settings; out of range is clamped', async () => {
  const { flow, calls } = makeFlow({ picks: [newDir('proj'), newDir('proj')] });
  await flow.estimate('a timer', { capMinutes: null, style: '', files: [] });
  await flow.confirm();
  assert.equal(calls.builds[0].capMinutes, undefined);
  await flow.estimate('a timer', { capMinutes: 999 });
  await flow.confirm();
  assert.equal(calls.builds[1].capMinutes, 120);
});

test('the time cap ends a build at the run time from Advanced', async () => {
  const folder = newDir('proj');
  assert.deepEqual(await prepareProjectFolder(folder), { ok: true });
  const entry = await runBuild(
    { request: 'x', estimate, folder, settings: settings(), capMinutes: 7 },
    {
      log: () => {},
      setStatus: () => {},
      startRun: (opts) => runClaude({ ...opts, timeoutMs: 300 }).done, // 7 min, shortened
      env: { FAKE_CLAUDE_MODE: 'hang' },
    },
  );
  assert.equal(entry.result, 'timed out');
  assert.match(entry.summary, /The 7 min time cap ran out/);
});

// Design style

test('the design style goes into the estimate prompt and the build prompt; empty lets Claude choose', () => {
  const style = 'like a 90s website, {{folder}} and $& kept';
  const est = estimatePrompt('Build me a cat site', { style });
  assert.ok(est.includes(`<design>\n${style}\n</design>`));
  const build = buildPrompt(readFileSync(PROMPT_FILE, 'utf8'), {
    request: 'Build me a cat site',
    estimate,
    folder: tmp,
    settings: settings(),
    style,
  });
  assert.ok(build.includes(`## Design direction\n\nThe person asked for this look and feel, in their words:\n<design>\n${style}\n</design>`));
  assert.doesNotMatch(build.replace(style, ''), /\{\{\w+\}\}/);

  assert.match(estimatePrompt('Build me x'), /Design direction:\nNone given: choose/);
  const plain = buildPrompt(readFileSync(PROMPT_FILE, 'utf8'), { request: 'x', estimate, folder: tmp, settings: settings() });
  assert.match(plain, /## Design direction\n\nNone given: choose/);
  assert.match(plain, /## Files from the person\n\nNone\./);
});

test('the style reaches the CLI in both runs', async () => {
  const dir = newDir('prompt');
  const estimateFile = path.join(dir, 'estimate.txt');
  const folder = newDir('proj');
  const { flow, calls } = makeFlow({ picks: [folder], env: { FAKE_CLAUDE_PROMPT_FILE: estimateFile } });
  await flow.estimate('a cat site', { style: '  playful,\n pastel colours ' });
  assert.match(readFileSync(estimateFile, 'utf8'), /<design>\nplayful, pastel colours\n<\/design>/);
  await flow.confirm();
  const job = calls.builds[0];
  assert.equal(job.style, 'playful, pastel colours');

  const buildFile = path.join(dir, 'build.txt');
  await runBuild(job, {
    log: () => {},
    setStatus: () => {},
    startRun: (opts) => runClaude(opts).done,
    env: { FAKE_CLAUDE_PROMPT_FILE: buildFile },
  });
  assert.match(readFileSync(buildFile, 'utf8'), /<design>\nplayful, pastel colours\n<\/design>/);
});

// Files

test('files are looked at, not opened: size and a type from the name; folders are refused', () => {
  const photo = sourceFile('cat.JPG', 'x'.repeat(2048));
  const folder = newDir('photos');
  const { files, refused } = inspectFiles([photo, folder, path.join(tmp, 'missing.png')]);
  assert.deepEqual(files, [{ path: photo, name: 'cat.JPG', size: 2048, type: 'image/jpeg' }]);
  assert.equal(refused.length, 2);
  assert.match(refused[0], /is a folder/);
  assert.match(refused[1], /could not be found/);
  assert.equal(fileType('notes.unknownext'), 'file');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(2_400_000), '2.3 MB');
  assert.equal(formatSize(MAX_TOTAL_BYTES), '200 MB');

  const res = checkOptions({ files: [photo, folder] });
  assert.equal(res.ok, false);
  assert.match(res.error, /folder/);
});

test('clashing names get a number, ignoring case like Windows does', () => {
  const taken = new Set();
  assert.equal(uniqueName('cat.jpg', taken), 'cat.jpg');
  assert.equal(uniqueName('cat.jpg', taken), 'cat (2).jpg');
  assert.equal(uniqueName('Cat.JPG', taken), 'Cat (3).JPG');
  assert.equal(uniqueName('README', taken), 'README');
  assert.equal(uniqueName('readme', taken), 'readme (2)');
});

test('files are copied into assets/ with their names, clashes numbered, and committed', async () => {
  const folder = newDir('proj');
  assert.deepEqual(await prepareProjectFolder(folder), { ok: true });
  const a = sourceFile('cat.jpg', 'first cat');
  const b = sourceFile('cat.jpg', 'second cat');
  const c = sourceFile('logo.svg', '<svg/>');
  const { files } = inspectFiles([a, b, c]);
  const copied = await copyIntoAssets(folder, files);

  assert.deepEqual(copied, [
    { name: 'cat.jpg', size: 9, type: 'image/jpeg' },
    { name: 'cat (2).jpg', size: 10, type: 'image/jpeg' },
    { name: 'logo.svg', size: 6, type: 'image/svg+xml' },
  ]);
  assert.deepEqual(readdirSync(path.join(folder, 'assets')).sort(), ['cat (2).jpg', 'cat.jpg', 'logo.svg']);
  assert.equal(readFileSync(path.join(folder, 'assets', 'cat.jpg'), 'utf8'), 'first cat');
  assert.equal(readFileSync(path.join(folder, 'assets', 'cat (2).jpg'), 'utf8'), 'second cat');
  assert.equal(readFileSync(a, 'utf8'), 'first cat', 'the originals are left alone');
  assert.equal(git(folder, 'status', '--porcelain'), '', 'Claude starts from a clean tree');
  assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '2');
  assert.match(git(folder, 'log', '-1', '--format=%s'), /files supplied/);
});

test('the whole flow: files go into assets/ before the build, and the build prompt lists them', async () => {
  const folder = newDir('proj');
  const photo = sourceFile('my-cat.png', 'meow');
  const { flow, calls } = makeFlow({ picks: [folder] });
  await flow.estimate('a website about my cat', { files: [photo] });
  assert.equal((await flow.confirm()).status, 'built');
  assert.ok(calls.statuses.includes('Copying your files'));
  const job = calls.builds[0];
  assert.deepEqual(job.files, [{ name: 'my-cat.png', size: 4, type: 'image/png' }]);
  assert.equal(readFileSync(path.join(folder, 'assets', 'my-cat.png'), 'utf8'), 'meow');

  const prompt = buildPrompt(readFileSync(PROMPT_FILE, 'utf8'), job);
  assert.match(prompt, /## Files from the person\n\nThe person supplied this file to use in the project/);
  assert.match(prompt, /already in the assets\/ folder here, committed:\n- assets\/my-cat\.png \(image\/png, 4 B\)/);
  assert.match(prompt, /Do not delete, rename or edit them/);
  assert.ok(!prompt.includes(path.dirname(photo)), 'where the file came from is not passed on');

  // The fake build sees them in its folder and commits on top.
  const entry = await runBuild(job, { log: () => {}, setStatus: () => {}, startRun: (opts) => runClaude(opts).done });
  assert.equal(entry.result, 'done');
  assert.match(readFileSync(path.join(folder, 'README.md'), 'utf8'), /Files in assets\/: my-cat\.png/);
  assert.deepEqual(entry.commits.map((c) => c.subject), ['Add README']);
});

test('the estimate only gets the file names, types and sizes, in an empty folder', async () => {
  const photo = sourceFile('holiday.jpg', 'SECRET-PIXELS-123');
  const promptFile = path.join(newDir('prompt'), 'estimate.txt');
  const { flow, calls } = makeFlow({ env: { FAKE_CLAUDE_PROMPT_FILE: promptFile } });
  assert.equal((await flow.estimate('a photo site', { files: [photo] })).status, 'ok');

  const prompt = readFileSync(promptFile, 'utf8');
  assert.match(prompt, /Files supplied by the person:\nThe person will supply this file/);
  assert.match(prompt, /- holiday\.jpg \(image\/jpeg, 17 B\)/);
  assert.ok(!prompt.includes('SECRET-PIXELS-123'), 'never the contents');
  assert.ok(!prompt.includes(path.dirname(photo)), 'never the path');
  assert.ok(!prompt.includes('assets/holiday.jpg'));

  const reply = calls.logs.filter((l) => l.kind === 'stdout').map((l) => JSON.parse(l.text)).at(-1);
  assert.deepEqual(reply.fake.cwdEntries, [], 'nothing is copied into the estimate folder');
  assert.ok(calls.logs.some((l) => /only their names, types and sizes go to the estimate/.test(l.text)));
});

test('over 200 MB in all is refused with a clear message, before anything runs', async () => {
  const big = path.join(newDir('big'), 'video.mp4');
  writeFileSync(big, '');
  truncateSync(big, 150 * 1024 * 1024);
  const big2 = path.join(newDir('big'), 'video2.mp4');
  writeFileSync(big2, '');
  truncateSync(big2, 60 * 1024 * 1024);
  try {
    assert.equal(checkOptions({ files: [big] }).ok, true, '150 MB fits');
    const res = checkOptions({ files: [big, big2] });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'These files add up to 210 MB, over the 200 MB limit. Remove some and try again.');
    assert.equal(checkOptions({ files: [big, big] }).ok, true, 'the same file twice counts once');

    const { flow, calls } = makeFlow();
    const outcome = await flow.estimate('a video site', { files: [big, big2] });
    assert.equal(outcome.status, 'error');
    assert.match(outcome.error, /over the 200 MB limit/);
    assert.equal(calls.statuses.length, 0, 'no estimate was started');
    assert.equal(flow.busy, false);
  } finally {
    rmSync(big, { force: true });
    rmSync(big2, { force: true });
  }
});
