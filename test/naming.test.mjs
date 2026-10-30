// Project folder names (src/main/naming.ts): cleaning a name to be safe on Windows, and
// making one from the request when the estimate has none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, nameFromRequest, numberedName, projectName, safeFolderName } from '../dist/main/naming.js';

const SAFE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

test('spaces and punctuation become single hyphens, lowercase, none at the ends', () => {
  assert.equal(cleanName('Pixel Art Editor'), 'pixel-art-editor');
  assert.equal(cleanName('  my_cool.app!!  '), 'my-cool-app');
  assert.equal(cleanName('--snake--game--'), 'snake-game');
  assert.equal(cleanName('.hidden.'), 'hidden');
  assert.equal(cleanName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(cleanName('gunblocks'), 'gunblocks');
  assert.equal(cleanName('2048 clone'), '2048-clone');
});

test('accents are dropped and other unicode is left out', () => {
  assert.equal(cleanName('Café Crème'), 'cafe-creme');
  assert.equal(cleanName('Ångström Über naïve'), 'angstrom-uber-naive');
  assert.equal(cleanName('🐍 snake 🎮'), 'snake');
  assert.equal(cleanName('日本語 todo'), 'todo');
  assert.equal(cleanName('ﬁle tool'), 'file-tool', 'compatibility forms are spelled out');
  assert.equal(cleanName('日本語'), null);
});

test('reserved Windows names are never used', () => {
  for (const name of ['con', 'CON', 'prn', 'aux', 'Nul', 'com1', 'COM9', 'lpt1', 'lpt9', ' con ', 'con.', '.aux']) {
    assert.equal(cleanName(name), null, name);
  }
  // Only the whole name is reserved.
  assert.equal(cleanName('console'), 'console');
  assert.equal(cleanName('con-app'), 'con-app');
  assert.equal(cleanName('com10'), 'com10');
  assert.equal(cleanName('com0'), 'com0');
});

test('long names are cut to 40 characters, at a hyphen where there is one', () => {
  const cut = cleanName('a very long project name that goes on and on and on forever');
  assert.equal(cut, 'a-very-long-project-name-that-goes-on');
  assert.ok(cut.length <= 40);
  const noHyphens = cleanName('x'.repeat(100));
  assert.equal(noHyphens, 'x'.repeat(40));
  assert.equal(cleanName('a'.repeat(39) + '-bcd').length, 39, 'no hyphen left at the end');
  assert.equal(cleanName('ab-' + 'c'.repeat(60)), 'ab-' + 'c'.repeat(37), 'an early hyphen is not worth cutting at');
});

test('nothing usable: null, and "project" as the safe name', () => {
  for (const raw of ['', '   ', '...', '---', '!!!', undefined, null, 42, {}]) {
    assert.equal(cleanName(raw), null, String(raw));
    assert.equal(safeFolderName(raw), 'project');
  }
});

test('a name from the request: no "build me", the "what" only, filler left out', () => {
  assert.equal(nameFromRequest('Build me a pomodoro timer'), 'pomodoro-timer');
  assert.equal(nameFromRequest('Build me a pomodoro timer with a big start button'), 'pomodoro-timer');
  assert.equal(nameFromRequest('Build me a CSV to JSON converter for the command line'), 'csv-json-converter');
  assert.equal(nameFromRequest('Build me a command-line tool that renames photos by date'), 'command-line-tool');
  assert.equal(nameFromRequest('Build me a website about my cat, with a photo gallery'), 'website-cat');
  assert.equal(nameFromRequest('Build me a to-do list web page'), 'to-do-list-web-page');
  assert.equal(nameFromRequest('build me: The Snake Game'), 'snake-game');
  assert.equal(nameFromRequest('a first-person 3D maze with a timer'), 'first-person-3d-maze');
  assert.equal(nameFromRequest('Build me an app\nwith\ttabs'), 'app');
});

test('a name from the request: at most four words, and never empty or reserved', () => {
  assert.equal(nameFromRequest('Build me one two three four five six'), 'one-two-three-four');
  assert.equal(nameFromRequest('Build me'), 'project');
  assert.equal(nameFromRequest('Build me 日本語のアプリ'), 'project');
  assert.equal(nameFromRequest('Build me a con'), 'project');
  assert.equal(nameFromRequest('Build me the AUX'), 'project');
  const long = nameFromRequest(`Build me ${'supercalifragilistic '.repeat(4)}`);
  assert.ok(long.length <= 40 && SAFE.test(long), long);
});

test('the estimate name wins when usable, else the request', () => {
  assert.equal(projectName('pixel-art-editor', 'Build me a drawing tool'), 'pixel-art-editor');
  assert.equal(projectName('Pixel Art Editor', 'Build me a drawing tool'), 'pixel-art-editor');
  assert.equal(projectName('', 'Build me a drawing tool'), 'drawing-tool');
  assert.equal(projectName(undefined, 'Build me a drawing tool'), 'drawing-tool');
  assert.equal(projectName('nul', 'Build me a drawing tool'), 'drawing-tool');
});

test('numbered names: -2, -3, ... within 40 characters', () => {
  assert.equal(numberedName('app', 1), 'app');
  assert.equal(numberedName('app', 2), 'app-2');
  assert.equal(numberedName('app', 13), 'app-13');
  const forty = 'x'.repeat(40);
  assert.equal(numberedName(forty, 2), 'x'.repeat(38) + '-2');
  assert.equal(numberedName(forty, 100).length, 40);
  assert.equal(numberedName('a'.repeat(37) + '-b', 2), 'a'.repeat(37) + '-2', 'no double hyphen where it is cut');
});

test('every name that comes out is safe', () => {
  const inputs = ['Hello, World!', 'ÆØÅ', 'con', 'x'.repeat(300), '-a-', 'Ünïcödé', 'tab\there', 'émoji 🎉 party', 'lpt5'];
  for (const raw of inputs) {
    const name = safeFolderName(raw);
    assert.ok(SAFE.test(name) && name.length <= 40, `${raw} -> ${name}`);
    const fromRequest = nameFromRequest(`Build me ${raw}`);
    assert.ok(SAFE.test(fromRequest) && fromRequest.length <= 40, `${raw} -> ${fromRequest}`);
  }
});
