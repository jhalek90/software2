#!/usr/bin/env node
// A fake claude CLI for tests and for trying the app without Claude.
// Never calls anything; prints canned output shaped like the real CLI's.
//
// Output depends on the args, like the real one:
//   --version                        prints a version line
//   -p ... --output-format json      one JSON result object
//   -p ... --output-format stream-json   JSON lines: system init, assistant text, result
//   -p ... (text, the default)       the result text
// The prompt is read from stdin (or taken from the argument after -p).
// For an estimate prompt (it contains "software2 estimate") the default result is a
// valid estimate JSON, so the app can be tried end to end.
// For a build prompt (it contains "software2 build") with stream-json, it does a tiny
// build in its working folder, like the real one would: writes README.md and commits
// it with git, streaming the tool calls (Write, Bash) and their results.
//
// Environment, for test scenarios:
//   FAKE_CLAUDE_MODE        normal (default) | fail | hang | hang-with-child
//     fail: writes to stderr and exits with FAKE_CLAUDE_EXIT_CODE (default 1)
//     hang: prints the first line, then never exits
//     hang-with-child: like hang, but first starts a child process that also hangs
//                      and writes its pid to FAKE_CLAUDE_CHILD_PID_FILE
//   FAKE_CLAUDE_DELAY_MS    pause before each output line (default 50)
//   FAKE_CLAUDE_RESULT      the result text (default: a short canned answer)
//   FAKE_CLAUDE_EXIT_CODE   exit code in normal and fail modes (default 0 / 1)
//   FAKE_CLAUDE_PROMPT_FILE write the prompt it got to this file (tests read it back)

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const env = process.env;
const mode = env.FAKE_CLAUDE_MODE || 'normal';
const delayMs = Number(env.FAKE_CLAUDE_DELAY_MS ?? 50);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (process.argv[2] === '--hang-child') {
  // The grandchild for hang-with-child.
  setInterval(() => {}, 1 << 30);
} else {
  main().catch((err) => {
    process.stderr.write(`fake-claude: ${err.stack || err}\n`);
    process.exit(1);
  });
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function out(line) {
  await sleep(delayMs);
  process.stdout.write(line + '\n');
}

async function main() {
  if (flag('--version') || flag('-v')) {
    process.stdout.write('0.0.0-fake (Claude Code)\n');
    return;
  }

  const pArg = value('-p') ?? value('--print');
  const prompt = pArg && !pArg.startsWith('-') ? pArg : await readStdin();
  if (env.FAKE_CLAUDE_PROMPT_FILE) writeFileSync(env.FAKE_CLAUDE_PROMPT_FILE, prompt);
  const format = value('--output-format') || 'text';
  const sessionId = '00000000-0000-4000-8000-000000000000';
  const cannedEstimate = JSON.stringify({
    minutes: 2,
    summary: 'A fake build that writes a README, for trying software2 without Claude.',
    stack: 'Plain text',
    steps: ['Write README.md', 'Commit it'],
    risks: ['Nothing real gets built'],
  });
  const result =
    env.FAKE_CLAUDE_RESULT ??
    (prompt.includes('software2 estimate') ? cannedEstimate : `Fake answer to: ${prompt.trim().slice(0, 80)}`);

  if (mode === 'fail') {
    await sleep(delayMs);
    process.stderr.write('fake-claude: something went wrong\n');
    process.exit(Number(env.FAKE_CLAUDE_EXIT_CODE ?? 1));
  }

  if (mode === 'hang-with-child') {
    const child = spawn(process.execPath, [process.argv[1], '--hang-child'], { stdio: 'ignore' });
    if (env.FAKE_CLAUDE_CHILD_PID_FILE) writeFileSync(env.FAKE_CLAUDE_CHILD_PID_FILE, String(child.pid));
  }

  const init = {
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    session_id: sessionId,
    model: 'fake-claude',
    permissionMode: flag('--dangerously-skip-permissions') ? 'bypassPermissions' : (value('--permission-mode') ?? 'default'),
    tools: ['Bash', 'Read', 'Write', 'Edit'],
    // Not in the real CLI: lets tests see what they were called with.
    fake: { args, promptLength: prompt.length },
  };
  const assistant = {
    type: 'assistant',
    session_id: sessionId,
    message: { role: 'assistant', content: [{ type: 'text', text: result }] },
  };
  const final = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 3 * delayMs,
    num_turns: 1,
    result,
    session_id: sessionId,
    total_cost_usd: 0,
  };
  // Not in the real CLI either: what the json-mode call looked like.
  const finalWithFake = { ...final, fake: { args, cwd: process.cwd(), cwdEntries: readdirSync(process.cwd()), promptLength: prompt.length } };

  if (mode === 'hang' || mode === 'hang-with-child') {
    await out(format === 'stream-json' ? JSON.stringify(init) : 'fake-claude: hanging');
    setInterval(() => {}, 1 << 30);
    return;
  }

  if (format === 'stream-json' && prompt.includes('software2 build')) {
    await out(JSON.stringify(init));
    await fakeBuild(prompt, sessionId, final);
  } else if (format === 'stream-json') {
    await out(JSON.stringify(init));
    await out(JSON.stringify(assistant));
    await out(JSON.stringify(final));
  } else if (format === 'json') {
    await out(JSON.stringify(finalWithFake));
  } else {
    await out(result);
  }
  process.exitCode = Number(env.FAKE_CLAUDE_EXIT_CODE ?? 0);
}

/** The build: README.md and one commit in the working folder. */
async function fakeBuild(prompt, sessionId, final) {
  const say = (content) => out(JSON.stringify({ type: 'assistant', session_id: sessionId, message: { role: 'assistant', content } }));
  const toolResult = (id, content, isError = false) =>
    out(JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    }));
  const request = (prompt.match(/<request>\s*([\s\S]*?)\s*<\/request>/) ?? [])[1] ?? '';
  const readme = path.join(process.cwd(), 'README.md');
  const assets = existsSync('assets') ? readdirSync('assets') : [];

  await say([
    { type: 'text', text: 'I will write a README and commit it.' },
    { type: 'tool_use', id: 'tool_1', name: 'Write', input: { file_path: readme, content: '...' } },
  ]);
  writeFileSync(readme, `# Fake build

Request: ${request}
${assets.length ? `
Files in assets/: ${assets.join(', ')}
` : ''}
Written by test/fake-claude.mjs; nothing real was built.
`);
  await toolResult('tool_1', `File created successfully at: ${readme}`);

  const command = 'git add -A && git commit -m "Add README"';
  await say([{ type: 'tool_use', id: 'tool_2', name: 'Bash', input: { command, description: 'Commit the README' } }]);
  let output;
  let failed = false;
  try {
    execFileSync('git', ['add', '-A'], { stdio: 'pipe' });
    output = execFileSync('git', ['-c', 'user.name=fake-claude', '-c', 'user.email=fake@localhost', 'commit', '-m', 'Add README'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    failed = true;
    output = String(err.stderr || err.message);
  }
  await toolResult('tool_2', output, failed);

  const result = env.FAKE_CLAUDE_RESULT ?? 'Built a README (fake). It works: README.md is committed. Not done: everything else.';
  await say([{ type: 'text', text: result }]);
  await out(JSON.stringify({ ...final, num_turns: 3, result }));
  process.exitCode = Number(env.FAKE_CLAUDE_EXIT_CODE ?? 0);
}
