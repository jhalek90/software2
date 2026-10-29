// Runner tests. They only ever run test/fake-claude.mjs, never the real claude CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from '../dist/main/runner.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-runner-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

function run(opts) {
  const stdout = [];
  const stderr = [];
  const handle = runClaude({
    cliPath: FAKE,
    args: [],
    cwd: tmp,
    ...opts,
    onStdout: (line) => {
      stdout.push(line);
      opts.onStdout?.(line, handle);
    },
    onStderr: (line) => stderr.push(line),
  });
  return { handle, stdout, stderr };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

test('streams stream-json lines one by one and passes stdin', async () => {
  const seenAt = [];
  const { handle, stdout } = run({
    args: ['-p', '--output-format', 'stream-json', '--verbose'],
    stdin: 'make me a todo app',
    env: { FAKE_CLAUDE_DELAY_MS: '150' },
    onStdout: () => seenAt.push(Date.now()),
  });
  const result = await handle.done;

  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 0);
  const events = stdout.map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ['system', 'assistant', 'result']);
  assert.equal(events[0].fake.promptLength, 'make me a todo app'.length);
  assert.equal(events[0].cwd, tmp);
  assert.match(events[2].result, /todo app/);
  // Lines arrive as they are printed, not all at the end.
  assert.ok(seenAt[2] - seenAt[0] >= 200, `lines came ${seenAt[2] - seenAt[0]} ms apart`);
});

test('json output is one line', async () => {
  const { handle, stdout } = run({
    args: ['-p', '--output-format', 'json'],
    stdin: 'hi',
    env: { FAKE_CLAUDE_RESULT: '{"minutes":3}' },
  });
  const result = await handle.done;
  assert.equal(result.status, 'exited');
  assert.equal(stdout.length, 1);
  assert.equal(JSON.parse(stdout[0]).result, '{"minutes":3}');
});

test('reports a non-zero exit code and stderr', async () => {
  const { handle, stderr } = run({ args: ['-p'], env: { FAKE_CLAUDE_MODE: 'fail', FAKE_CLAUDE_EXIT_CODE: '3' } });
  const result = await handle.done;
  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 3);
  assert.match(stderr.join('\n'), /something went wrong/);
});

test('stop() ends a hanging run', async () => {
  const { handle, stdout } = run({
    args: ['-p', '--output-format', 'stream-json'],
    env: { FAKE_CLAUDE_MODE: 'hang' },
    onStdout: (_line, h) => h.stop(),
  });
  const result = await handle.done;
  assert.equal(result.status, 'stopped');
  assert.equal(stdout.length, 1);
  assert.ok(result.durationMs < 5000);
});

test('stop() kills the whole process tree', async () => {
  const pidFile = path.join(tmp, 'child-node.pid');
  const { handle } = run({
    args: ['-p'],
    env: { FAKE_CLAUDE_MODE: 'hang-with-child', FAKE_CLAUDE_CHILD_PID_FILE: pidFile },
    onStdout: (_line, h) => h.stop(),
  });
  const result = await handle.done;
  assert.equal(result.status, 'stopped');
  const childPid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(await waitFor(() => !isAlive(childPid)), `grandchild ${childPid} is still running`);
});

test('the time cap kills a run that takes too long', async () => {
  const { handle } = run({ args: ['-p'], env: { FAKE_CLAUDE_MODE: 'hang' }, timeoutMs: 500 });
  const result = await handle.done;
  assert.equal(result.status, 'timeout');
  assert.ok(result.durationMs >= 450 && result.durationMs < 5000, `took ${result.durationMs} ms`);
});

test('a run that ends in time is not affected by the cap', async () => {
  const { handle } = run({ args: ['-p'], stdin: 'x', timeoutMs: 10_000 });
  assert.equal((await handle.done).status, 'exited');
});

test('a missing CLI gives a clear error', async () => {
  const missing = path.join(tmp, 'no-such-claude.exe');
  const { handle } = run({ cliPath: missing, args: ['-p'] });
  const result = await handle.done;
  assert.equal(result.status, 'error');
  assert.equal(result.exitCode, null);
  assert.match(result.error, /not found/);
  assert.ok(result.error.includes(missing));
  handle.stop(); // harmless
});

test('an empty CLI path gives a clear error', async () => {
  const result = await run({ cliPath: '' }).handle.done;
  assert.equal(result.status, 'error');
  assert.match(result.error, /not found/);
});

test('a missing working folder gives a clear error', async () => {
  const result = await run({ cwd: path.join(tmp, 'nope') }).handle.done;
  assert.equal(result.status, 'error');
  assert.match(result.error, /Working folder/);
});

// npm installs claude as a .cmd shim; these go through cmd.exe like the real one would.
const onWindows = process.platform === 'win32';

function makeCmdShim() {
  const dir = mkdtempSync(path.join(tmp, 'shim dir '));
  const shim = path.join(dir, 'claude.cmd');
  writeFileSync(shim, `@"${process.execPath}" "${FAKE}" %*\r\n`);
  assert.ok(existsSync(shim));
  return shim;
}

test('runs a .cmd shim with args and stdin', { skip: !onWindows }, async () => {
  const { handle, stdout } = run({
    cliPath: makeCmdShim(),
    args: ['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions'],
    stdin: 'hello from stdin',
  });
  const result = await handle.done;
  assert.equal(result.status, 'exited');
  assert.equal(result.exitCode, 0);
  const init = JSON.parse(stdout[0]);
  assert.equal(init.permissionMode, 'bypassPermissions');
  assert.equal(init.fake.promptLength, 'hello from stdin'.length);
});

test('stop() through a .cmd shim kills node under cmd.exe', { skip: !onWindows }, async () => {
  const pidFile = path.join(tmp, 'shim-child.pid');
  const { handle } = run({
    cliPath: makeCmdShim(),
    args: ['-p'],
    env: { FAKE_CLAUDE_MODE: 'hang-with-child', FAKE_CLAUDE_CHILD_PID_FILE: pidFile },
    onStdout: (_line, h) => h.stop(),
  });
  const result = await handle.done;
  assert.equal(result.status, 'stopped');
  const childPid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(await waitFor(() => !isAlive(childPid)), `grandchild ${childPid} is still running`);
});

test('refuses args cmd.exe would expand', { skip: !onWindows }, async () => {
  const result = await run({ cliPath: makeCmdShim(), args: ['%PATH%'] }).handle.done;
  assert.equal(result.status, 'error');
  assert.match(result.error, /not allowed/);
});
