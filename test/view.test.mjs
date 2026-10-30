// The page's views (src/renderer/view.ts): which parts show while composing, building and
// on the result card, and what moves between them. view.js is a plain browser script, so
// it is run in a vm context here, with stand-ins for the page's elements.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../dist/renderer/view.js', import.meta.url), 'utf8'), ctx);
const { nextView, applyView, buildingLine } = ctx;

/** Runs a list of events from a starting view; returns each view it passed through. */
function walk(start, events) {
  const views = [];
  let view = start;
  for (const event of events) views.push((view = nextView(view, event)));
  return views;
}

/** Which of the page's parts show in a view, starting from the page as it loads. */
function shown(view) {
  const page = {
    hero: { hidden: false },
    'request-form': { hidden: false },
    building: { hidden: true },
    result: { hidden: true },
  };
  applyView(view, (id) => {
    assert.ok(page[id], `unknown element #${id}`);
    return page[id];
  });
  return Object.keys(page).filter((id) => !page[id].hidden);
}

test('composing shows the question and the box; building only the "Building" line; the result only its card', () => {
  assert.deepEqual(shown('compose'), ['hero', 'request-form']);
  assert.deepEqual(shown('building'), ['building']);
  assert.deepEqual(shown('result'), ['result']);
});

test('the box stays during the estimate and the confirm card', () => {
  const status = (s) => ({ type: 'status', status: s });
  assert.deepEqual(walk('compose', [status('Estimating...'), status('Waiting for you to confirm')]), ['compose', 'compose']);
  // Cancel on the confirm card, a failed estimate, a stopped one.
  assert.deepEqual(walk('compose', [status('Ready'), status('The estimate failed'), status('Cancelled')]), ['compose', 'compose', 'compose']);
});

test('the box leaves on "Build it" as the folder is made, and comes back on "Build something else"', () => {
  const status = (s) => ({ type: 'status', status: s });
  // With files: they are copied first. The flow's own status words come between.
  assert.deepEqual(
    walk('compose', [
      status('Creating the project folder'),
      status('Copying your files'),
      status('Building...'),
      { type: 'build-started' },
      status('Build done'),
      { type: 'build-ended' },
      status('Ready'),
      { type: 'result-closed' },
    ]),
    ['building', 'building', 'building', 'building', 'building', 'result', 'result', 'compose'],
  );
  // Without files; and the build-started event alone is enough too.
  assert.deepEqual(walk('compose', [status('Building...')]), ['building']);
  assert.deepEqual(walk('compose', [{ type: 'build-started' }]), ['building']);
});

test('a stopped, failed or timed-out build shows its result card first, then the box', () => {
  for (const result of ['stopped', 'failed', 'timed out']) {
    assert.deepEqual(
      walk('building', [{ type: 'status', status: `Build ${result}` }, { type: 'build-ended' }, { type: 'result-closed' }]),
      ['building', 'result', 'compose'],
      result,
    );
  }
});

test('the box comes straight back when no build ran (the folder or the files could not be made)', () => {
  assert.deepEqual(walk('building', [{ type: 'status', status: 'Ready' }, { type: 'confirm-error' }]), ['building', 'compose']);
  assert.deepEqual(
    walk('compose', [{ type: 'status', status: 'Creating the project folder' }, { type: 'status', status: 'Ready' }, { type: 'confirm-error' }]),
    ['building', 'building', 'compose'],
  );
  // After a build, an error from confirm does not take the result card away.
  assert.equal(nextView('result', { type: 'confirm-error' }), 'result');
  assert.equal(nextView('compose', { type: 'confirm-error' }), 'compose');
});

test('the "Building" line: what was asked for, on one line', () => {
  assert.equal(buildingLine('Build me a pomodoro timer'), 'Building: a pomodoro timer');
  assert.equal(buildingLine('a pomodoro timer'), 'Building: a pomodoro timer');
  assert.equal(buildingLine('  Build me a to-do list\n\nwith  dark mode\r\n'), 'Building: a to-do list with dark mode');
  assert.equal(buildingLine(''), 'Building...');
  const long = buildingLine(`Build me ${'x'.repeat(500)}`);
  assert.equal(long.length, 'Building: '.length + 200);
  assert.ok(long.endsWith('…'));
});
