// "How to run it" tests: RUN.json parsing (valid, missing, broken), the README fallback,
// static vs command for Run now, the first-time confirm, and the batch file handed to the
// terminal launcher (a stub: no window is opened). Whole builds use test/fake-claude.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../dist/main/build.js';
import {
  RunNow,
  installNeeded,
  localUrl,
  parseRunSpec,
  readHowToRun,
  readmeHowToRun,
  runPlan,
  terminalScript,
  waitForUrl,
} from '../dist/main/howtorun.js';
import { prepareProjectFolder } from '../dist/main/project.js';
import { runClaude } from '../dist/main/runner.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-howto-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
/** A new folder with these files in it. */
const project = (files = {}) => {
  const dir = path.join(tmp, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
};
const json = (obj) => JSON.stringify(obj);

// RUN.json

test('a static RUN.json is read, with its file checked to be in the folder', () => {
  const dir = project({ 'dist/index.html': '<p>hi</p>' });
  const res = parseRunSpec(json({ kind: 'static', open: 'dist/index.html', steps: ['Open dist/index.html.'], notes: 'Offline.' }), dir);
  assert.deepEqual(res, { spec: { kind: 'static', open: 'dist/index.html', steps: ['Open dist/index.html.'], notes: 'Offline.' } });
});

test('a command RUN.json is read; steps are made up when it gives none', () => {
  const dir = project();
  const res = parseRunSpec(json({ kind: 'command', install: 'npm install', command: 'npm run dev', url: 'http://localhost:5173' }), dir);
  assert.deepEqual(res.spec, {
    kind: 'command',
    install: 'npm install',
    command: 'npm run dev',
    url: 'http://localhost:5173/',
    steps: ['Open a terminal in the project folder.', 'Run npm install (once).', 'Run npm run dev.', 'Open http://localhost:5173/ in your browser.'],
  });
});

test('the kind is taken from what is there when it is left out; a BOM is fine', () => {
  const dir = project({ 'index.html': 'x' });
  assert.equal(parseRunSpec(json({ command: 'python app.py' }), dir).spec.kind, 'command');
  assert.equal(parseRunSpec('\uFEFF' + json({ open: 'index.html' }), dir).spec.kind, 'static');
});

test('a broken or unusable RUN.json says why', () => {
  const dir = project({ 'index.html': 'x' });
  const problem = (text) => parseRunSpec(text, dir).problem;
  assert.match(problem('{ "kind": '), /not valid JSON/);
  assert.match(problem('[1]'), /not a JSON object/);
  assert.match(problem(json({ kind: 'static' })), /no file to open/);
  assert.match(problem(json({ kind: 'static', open: 'missing.html' })), /not there/);
  assert.match(problem(json({ kind: 'static', open: '../outside.html' })), /outside the project/);
  assert.match(problem(json({ kind: 'static', open: 'C:\\Windows\\win.ini' })), /outside the project/);
  assert.match(problem(json({ kind: 'command' })), /no command/);
  assert.match(problem(json({ kind: 'command', command: 'npm start\r\ndel *' })), /more than one line/);
  assert.match(problem(json({ kind: 'command', command: 'npm start', url: 'https://example.com' })), /not a local http address/);
  assert.match(problem(json({ notes: 'hm' })), /neither/);
});

test('only local http addresses are kept', () => {
  assert.equal(localUrl('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(localUrl('http://127.0.0.1:8000/app'), 'http://127.0.0.1:8000/app');
  assert.equal(localUrl('http://0.0.0.0:8080'), 'http://localhost:8080/');
  assert.equal(localUrl('file:///C:/x.html'), null);
  assert.equal(localUrl('http://evil.example'), null);
  assert.equal(localUrl(42), null);
});

// The README fallback

const README = `# MineLove

A game.

## How to run

1. Install once:

\`\`\`
npm install
\`\`\`

2. Then open dist/index.html.

### Notes

Works offline.

## Choices

Vite, because.
`;

test("the README's How to run section is found, sub-headings kept, fences dropped", () => {
  assert.equal(readmeHowToRun(README), '1. Install once:\n\nnpm install\n\n2. Then open dist/index.html.\n\n### Notes\n\nWorks offline.');
  assert.equal(readmeHowToRun('# X\r\n\r\n## Getting started\r\n\r\nnpm start\r\n'), 'npm start');
  assert.equal(readmeHowToRun('# X\n\n## Usage\n\nRun it.'), 'Run it.');
  assert.equal(readmeHowToRun('# X\n\nNothing about running.\n\n## Choices\n\nNone.'), '');
  // A heading inside a code block is not a heading.
  assert.equal(readmeHowToRun('```\n# How to run\n```\n'), '');
});

test('readHowToRun: RUN.json first, then the README, then a plain "neither"', () => {
  const both = project({ 'RUN.json': json({ kind: 'command', command: 'npm start' }), 'README.md': README });
  assert.equal(readHowToRun(both).source, 'run.json');

  const broken = readHowToRun(project({ 'RUN.json': '{', 'README.md': README }));
  assert.equal(broken.source, 'readme');
  assert.match(broken.problem, /not valid JSON/);
  assert.match(broken.text, /npm install/);

  const missing = readHowToRun(project({ 'README.md': README }));
  assert.deepEqual([missing.source, missing.problem], ['readme', 'There is no RUN.json.']);

  const neither = readHowToRun(project({ 'README.md': '# X\n\nHi.\n' }));
  assert.deepEqual(neither, { source: 'none', problem: 'There is no RUN.json. The README has no "How to run" section.' });
  assert.deepEqual(readHowToRun(project()), { source: 'none', problem: 'There is no RUN.json. There is no README.md either.' });
});

// Run now: static vs command, and what goes to the terminal

test('static opens the file; command runs install only when node_modules is missing', () => {
  const dir = project({ 'index.html': 'x' });
  assert.deepEqual(runPlan({ kind: 'static', open: 'index.html', steps: [] }, dir), { kind: 'static', folder: dir, file: path.join(dir, 'index.html') });
  const spec = { kind: 'command', install: 'npm install', command: 'npm run dev', url: 'http://localhost:5173/', steps: [] };
  assert.deepEqual(runPlan(spec, dir), { kind: 'command', folder: dir, install: 'npm install', command: 'npm run dev', url: 'http://localhost:5173/' });
  mkdirSync(path.join(dir, 'node_modules'));
  assert.deepEqual(runPlan(spec, dir), { kind: 'command', folder: dir, command: 'npm run dev', url: 'http://localhost:5173/' });
  // Installs it cannot check always run.
  assert.equal(installNeeded('pip install -r requirements.txt', dir), true);
  assert.equal(installNeeded('pnpm i', dir), false);
});

test('the terminal script goes to the folder, runs the install (stopping if it fails), then the command', () => {
  const script = terminalScript({ kind: 'command', folder: 'C:\\Projects\\100% game', install: 'npm install', command: 'npm run dev' }, '100% game');
  const lines = script.split('\r\n');
  assert.ok(script.endsWith('\r\n'));
  assert.equal(lines[0], '@echo off');
  assert.ok(lines.includes('title software2: 100%% game'));
  assert.ok(lines.some((l) => l.startsWith('cd /d "C:\\Projects\\100%% game" ||')));
  const install = lines.indexOf('call npm install');
  const command = lines.indexOf('call npm run dev');
  assert.ok(install > 0 && command > install);
  assert.equal(lines[install - 1], '@echo on', 'the window shows each command as it runs');
  assert.match(lines[install + 2], /^if errorlevel 1 /);
  assert.ok(lines.at(-2).startsWith('pause'), 'the window stays open after the app stops');

  const noInstall = terminalScript({ kind: 'command', folder: 'C:\\p', command: 'python -m http.server 8000' }, 'p');
  assert.ok(!/errorlevel/.test(noInstall));
  assert.ok(noInstall.includes('\r\ncall python -m http.server 8000\r\n'));
});

/** RunNow with stubs: what was opened, the scripts given to the terminal, the notes. */
function stubRunNow({ up = true } = {}) {
  const calls = { files: [], scripts: [], urls: [], notes: [], waits: [] };
  let noted;
  const notedOnce = new Promise((r) => (noted = r));
  const runNow = new RunNow({
    openFile: async (file) => (calls.files.push(file), ''),
    openTerminal: async (script) => (calls.scripts.push(readFileSync(script, 'utf8')), ''),
    openUrl: async (url) => void calls.urls.push(url),
    note: (text) => {
      calls.notes.push(text);
      noted();
    },
    scriptDir: path.join(tmp, `scripts${++n}`),
    waitForUrl: async (url, ms) => (calls.waits.push([url, ms]), up),
  });
  return { runNow, calls, notedOnce };
}

test('Run now, static: the file opens in the browser, nothing runs in a terminal', async () => {
  const dir = project({ 'index.html': 'x' });
  const { runNow, calls } = stubRunNow();
  const res = await runNow.run({ kind: 'static', open: 'index.html', steps: [] }, dir, 'p');
  assert.deepEqual(res, { status: 'started', message: 'Opened index.html in your browser.' });
  assert.deepEqual(calls.files, [path.join(dir, 'index.html')]);
  assert.deepEqual(calls.scripts, []);
});

test('Run now, command: asks first with the exact commands, then runs only those, then opens the url', async () => {
  const dir = project();
  const spec = { kind: 'command', install: 'npm install', command: 'npm run dev', url: 'http://localhost:5173/', steps: [] };
  const { runNow, calls, notedOnce } = stubRunNow();

  const first = await runNow.run(spec, dir, 'game');
  assert.deepEqual(first, { status: 'confirm', folder: dir, install: 'npm install', command: 'npm run dev', url: 'http://localhost:5173/' });
  assert.deepEqual(calls.scripts, [], 'nothing runs before the person has said yes');

  const second = await runNow.run(spec, dir, 'game', true);
  assert.equal(second.status, 'started');
  assert.match(second.message, /new terminal window/);
  assert.equal(calls.scripts.length, 1);
  const lines = calls.scripts[0].split('\r\n');
  assert.deepEqual(lines.filter((l) => l.startsWith('call ')), ['call npm install', 'call npm run dev']);
  assert.ok(lines.includes(`cd /d "${dir}" || (echo Could not open the project folder. & pause & exit /b 1)`));
  await notedOnce;
  assert.deepEqual(calls.waits, [['http://localhost:5173/', 5 * 60_000]], 'a longer wait when an install runs first');
  assert.deepEqual(calls.urls, ['http://localhost:5173/']);
  assert.match(calls.notes[0], /Opened http:\/\/localhost:5173\//);

  // Once said yes, the same commands for the same folder run straight away.
  assert.equal((await runNow.run(spec, dir, 'game')).status, 'started');
  // Different commands are asked about again.
  assert.equal((await runNow.run({ ...spec, command: 'npm start' }, dir, 'game')).status, 'confirm');
});

test('Run now, command: a skipped install is shown in the confirm; a url that never answers is said', async () => {
  const dir = project({ 'node_modules/.keep': '' });
  const { runNow, calls, notedOnce } = stubRunNow({ up: false });
  const spec = { kind: 'command', install: 'npm install', command: 'npm run dev', url: 'http://localhost:5173/', steps: [] };
  const res = await runNow.run(spec, dir, 'game');
  assert.deepEqual(res, { status: 'confirm', folder: dir, installSkipped: 'npm install', command: 'npm run dev', url: 'http://localhost:5173/' });
  await runNow.run(spec, dir, 'game', true);
  assert.deepEqual(calls.scripts[0].split('\r\n').filter((l) => l.startsWith('call ')), ['call npm run dev']);
  await notedOnce;
  assert.deepEqual(calls.waits, [['http://localhost:5173/', 30_000]]);
  assert.deepEqual(calls.urls, []);
  assert.match(calls.notes[0], /did not answer within 30 s/);
});

test('Run now says so when the terminal cannot be opened', async () => {
  const runNow = new RunNow({
    openFile: async () => '',
    openTerminal: async () => 'no shell here',
    openUrl: async () => {},
    note: () => {},
    scriptDir: path.join(tmp, `scripts${++n}`),
  });
  const res = await runNow.run({ kind: 'command', command: 'npm start', steps: [] }, project(), 'p', true);
  assert.deepEqual(res, { status: 'error', message: 'Could not open a terminal window: no shell here' });
});

test('waitForUrl: true once anything answers, false when nothing does in time', async () => {
  const server = http.createServer((_req, res) => res.writeHead(404).end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    assert.equal(await waitForUrl(url, 2000, 50), true);
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(await waitForUrl(url, 300, 50), false);
});

// Whole builds with the fake CLI

async function fakeBuild(run) {
  const folder = path.join(tmp, `build${++n}`);
  await prepareProjectFolder(folder);
  const startRun = (opts) => runClaude(opts).done;
  return runBuild(
    {
      request: 'Build me a game',
      estimate: { minutes: 2, summary: 's', stack: '', steps: [], risks: [] },
      folder,
      settings: { claudePath: FAKE, projectsFolder: tmp, buildCapMinutes: 5, skipPermissions: true },
    },
    { log: () => {}, setStatus: () => {}, startRun, env: { FAKE_CLAUDE_DELAY_MS: '1', ...(run ? { FAKE_CLAUDE_RUN: run } : {}) } },
  );
}

test('a done build carries how to run it: static, command, broken, README only, neither', async () => {
  const stat = await fakeBuild('static');
  assert.equal(stat.result, 'done');
  assert.deepEqual(stat.howToRun, {
    source: 'run.json',
    spec: { kind: 'static', open: 'index.html', steps: ['Open index.html in your browser.', 'Click the board to start.'], notes: 'Works offline; nothing to install.' },
  });
  const command = await fakeBuild('command');
  assert.equal(command.howToRun.spec.kind, 'command');
  assert.equal(command.howToRun.spec.url, 'http://localhost:5173/');
  const broken = await fakeBuild('broken');
  assert.equal(broken.howToRun.source, 'readme');
  assert.match(broken.howToRun.problem, /not valid JSON/);
  assert.match(broken.howToRun.text, /npm start/);
  assert.equal((await fakeBuild('readme')).howToRun.source, 'readme');
  assert.equal((await fakeBuild()).howToRun.source, 'none');
});

test('a build that did not finish has no how-to-run', async () => {
  const folder = path.join(tmp, `build${++n}`);
  await prepareProjectFolder(folder);
  const outcome = await runBuild(
    {
      request: 'Build me a game',
      estimate: { minutes: 2, summary: 's', stack: '', steps: [], risks: [] },
      folder,
      settings: { claudePath: FAKE, projectsFolder: tmp, buildCapMinutes: 5, skipPermissions: true },
    },
    { log: () => {}, setStatus: () => {}, startRun: (opts) => runClaude(opts).done, env: { FAKE_CLAUDE_MODE: 'fail', FAKE_CLAUDE_DELAY_MS: '1' } },
  );
  assert.equal(outcome.result, 'failed');
  assert.equal(outcome.howToRun, undefined);
});
