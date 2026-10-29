import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath, loadSettings, saveSettings, SETTINGS_FILE } from '../dist/main/settings.js';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'software2-settings-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('defaults when there is no settings file', () => {
  const s = loadSettings(path.join(tmp, 'empty'));
  assert.equal(s.buildCapMinutes, 30);
  assert.equal(s.skipPermissions, true);
  assert.ok(s.projectsFolder.length > 0);
  assert.equal(typeof s.claudePath, 'string');
});

test('saves and loads', () => {
  const dir = path.join(tmp, 'roundtrip');
  saveSettings(dir, { claudePath: 'C:\\tools\\claude.exe', buildCapMinutes: 45, skipPermissions: false });
  const s = loadSettings(dir);
  assert.equal(s.claudePath, 'C:\\tools\\claude.exe');
  assert.equal(s.buildCapMinutes, 45);
  assert.equal(s.skipPermissions, false);
  // A partial change keeps the rest.
  saveSettings(dir, { projectsFolder: 'D:\\projects' });
  assert.deepEqual(loadSettings(dir), { ...s, projectsFolder: 'D:\\projects' });
  assert.equal(JSON.parse(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')).projectsFolder, 'D:\\projects');
});

test('bad values fall back to defaults', () => {
  const dir = path.join(tmp, 'bad');
  mkdirSync(dir);
  const file = path.join(dir, SETTINGS_FILE);
  writeFileSync(file, JSON.stringify({ buildCapMinutes: -5, skipPermissions: 'yes', projectsFolder: 7 }));
  const s = loadSettings(dir);
  assert.equal(s.buildCapMinutes, 30);
  assert.equal(s.skipPermissions, true);
  assert.equal(typeof s.projectsFolder, 'string');
  writeFileSync(file, 'not json');
  assert.equal(loadSettings(dir).buildCapMinutes, 30);
});

test('findOnPath finds a command by PATHEXT without running it', () => {
  const a = path.join(tmp, 'path-a');
  const b = path.join(tmp, 'path-b');
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(path.join(b, 'claude.cmd'), '@exit /b 99\r\n');
  const pathExt = '.COM;.EXE;.BAT;.CMD';
  const found = findOnPath('claude', [a, b].join(path.delimiter), pathExt);
  if (process.platform === 'win32') assert.equal(found?.toLowerCase(), path.join(b, 'claude.cmd').toLowerCase());
  assert.equal(findOnPath('claude', a, pathExt), null);
});
