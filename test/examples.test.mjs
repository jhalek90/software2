// The "build me" placeholder examples (src/renderer/examples.ts): the list itself, and the
// cycler that shuffles it. examples.js is a plain browser script, so it is run in a vm
// context here, like view.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
const src = readFileSync(new URL('../dist/renderer/examples.js', import.meta.url), 'utf8');
// A top-level const is not a property of the context, so ask the script for it.
const { EXAMPLES, exampleCycler } = vm.runInContext(`${src}\n({ EXAMPLES, exampleCycler });`, ctx);

/** A seeded random number source, so a failure can be run again. */
function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

test('there are about 100 examples, all different', () => {
  assert.ok(EXAMPLES.length >= 90 && EXAMPLES.length <= 110, `${EXAMPLES.length} examples`);
  const seen = new Set();
  for (const e of EXAMPLES) {
    const key = e.toLowerCase();
    assert.ok(!seen.has(key), `duplicate: ${e}`);
    seen.add(key);
  }
});

test('each one reads after "build me" and fits the box', () => {
  for (const e of EXAMPLES) {
    assert.match(e, /^an? [^ ]/, `does not start with "a " or "an ": ${e}`);
    assert.ok(e.length <= 60, `longer than 60 characters: ${e}`);
    assert.equal(e, e.trim(), `stray spaces: ${e}`);
  }
});

test('the cycler shows every example once per pass, and never the same one twice in a row', () => {
  for (const seed of [1, 7, 42, 2026]) {
    const next = exampleCycler(EXAMPLES, seeded(seed));
    let previous;
    for (let pass = 0; pass < 20; pass++) {
      const shown = [];
      for (let i = 0; i < EXAMPLES.length; i++) {
        const e = next();
        assert.notEqual(e, previous, `same example twice in a row (seed ${seed}, pass ${pass})`);
        shown.push((previous = e));
      }
      assert.deepEqual([...shown].sort(), [...EXAMPLES].sort(), `pass ${pass} is not every example once`);
    }
  }
});

test('the order is shuffled, not the list order', () => {
  const next = exampleCycler(EXAMPLES, seeded(3));
  const first = EXAMPLES.map(() => next());
  assert.notDeepEqual(first, [...EXAMPLES]);
});

test('a reshuffle that would repeat the last example moves it out of the first slot', () => {
  // With two examples, 0.9 leaves the first pass in list order and 0 swaps the second, so
  // it starts with what the first ended on, unless the cycler steps in.
  const randoms = [0.9, 0];
  const next = exampleCycler(['a one', 'a two'], () => randoms.shift() ?? 0.5);
  const shown = Array.from({ length: 8 }, () => next());
  for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], shown.join(', '));
});
