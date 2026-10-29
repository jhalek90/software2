import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { electronEnv, electronExe, projectDir } from '../scripts/launch.mjs';

test('the launcher starts Electron without ELECTRON_RUN_AS_NODE, in any case', () => {
  const env = electronEnv({ PATH: 'x', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', SOFTWARE2_DEMO: '1' });
  assert.deepEqual(env, { PATH: 'x', SOFTWARE2_DEMO: '1' });
});

test("the launcher runs Electron's own exe from this project", () => {
  assert.equal(electronExe('C:\\p'), join('C:\\p', 'node_modules', 'electron', 'dist', 'electron.exe'));
  assert.equal(readFileSync(join(projectDir, 'package.json'), 'utf8').includes('"name": "software2"'), true);
});

test('npm run launch and npm run shortcut point at the scripts', () => {
  const { scripts } = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  assert.equal(scripts.launch, 'node scripts/launch.mjs');
  assert.equal(scripts.shortcut, 'node scripts/shortcut.mjs');
  const vbs = readFileSync(join(projectDir, 'scripts', 'launch.vbs'), 'utf8');
  assert.match(vbs, /scripts\\launch\.mjs"" --log/);
});
