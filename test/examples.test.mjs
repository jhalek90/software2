// The "build me" placeholder examples (src/renderer/examples.ts): the base entries, the
// word lists their {slots} are filled from, the cycler that shuffles them and the generator
// that hands out what the box shows. examples.js is a plain browser script, so it is run in
// a vm context here, like view.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
const src = readFileSync(new URL('../dist/renderer/examples.js', import.meta.url), 'utf8');
// A top-level const is not a property of the context, so ask the script for it.
const {
  EXAMPLES, EXAMPLE_SLOTS, EXAMPLE_NUMBER_SLOTS, EXAMPLE_MAX_LENGTH, EXAMPLE_PACE, EXAMPLE_FADE_MS,
  EXAMPLE_SLOTTED_EVERY, EXAMPLE_REEL_WORDS, EXAMPLE_ROLL_MS, EXAMPLE_REEL_STAGGER_MS,
  exampleCycler, exampleGenerator, exampleParts, fillExample, fixArticles, reelWords,
} = vm.runInContext(
  `${src}\n({ EXAMPLES, EXAMPLE_SLOTS, EXAMPLE_NUMBER_SLOTS, EXAMPLE_MAX_LENGTH, EXAMPLE_PACE, EXAMPLE_FADE_MS,
    EXAMPLE_SLOTTED_EVERY, EXAMPLE_REEL_WORDS, EXAMPLE_ROLL_MS, EXAMPLE_REEL_STAGGER_MS,
    exampleCycler, exampleGenerator, exampleParts, fillExample, fixArticles, reelWords });`,
  ctx,
);

/** A seeded random number source, so a failure can be run again. */
function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

const SLOT = /\{(\w+)\}/g;
const slotsOf = (entry) => [...entry.matchAll(SLOT)].map((m) => m[1]);

/** Words that may start with a capital letter: names, places and languages. Anything else
 *  capitalised is either an acronym (CSV, 3D) or a slip, perhaps a brand. */
const CAPITALISED = new Set([
  'Celsius', 'Earth', 'Egypt', 'Fahrenheit', 'Fourier', 'French', 'Gantt', 'Go', 'Hanoi',
  'Japanese', 'Morse', 'Pythagoras', 'Roman', 'Spanish', 'Tower', 'Turing', 'Voronoi',
]);

/** How each "a"/"an" should read, worked out here on its own so a slip in articleFor()
 *  shows up: by the sound of the next word, with the exceptions these lists contain. */
function wantsAn(word) {
  if (/^\d/.test(word)) return /^(8|1[18](\D|$))/.test(word);
  if (/^(MIDI|README)/.test(word)) return false;
  if (/^[A-Z]{2,}/.test(word)) return 'AEFHILMNORSX'.includes(word[0]);
  if (/^(unicorn|uniform|unique|unit|use|eu|one\b)/i.test(word)) return false;
  if (/^hour/i.test(word)) return true;
  return /^[aeiou]/i.test(word);
}

/** The style rules, for a base entry with no slots or a filled one. */
function checkStyle(text, where) {
  assert.match(text, /^an? [^ ]/, `does not start with "a " or "an ": ${text} (${where})`);
  assert.ok(text.length <= EXAMPLE_MAX_LENGTH, `longer than ${EXAMPLE_MAX_LENGTH} characters: ${text} (${where})`);
  assert.equal(text, text.trim(), `stray spaces: ${text}`);
  assert.doesNotMatch(text, /  /, `double space: ${text}`);
  assert.doesNotMatch(text, /[{}]/, `a slot left unfilled: ${text} (${where})`);
  for (const m of text.matchAll(/(?:^| )(a|an) (\S+)/g)) {
    assert.equal(m[1], wantsAn(m[2]) ? 'an' : 'a', `"${m[1]} ${m[2]}" in: ${text} (${where})`);
  }
  for (const word of text.split(/[ ,]+/)) {
    if (/^[A-Z][a-z]/.test(word)) assert.ok(CAPITALISED.has(word), `capitalised "${word}" in: ${text}`);
  }
}

/** Every filling of an entry, all combinations, articles fixed. */
function allFillings(entry) {
  let out = [entry];
  for (const name of slotsOf(entry)) {
    out = out.flatMap((text) => EXAMPLE_SLOTS[name].map((word) => text.replace(`{${name}}`, word)));
  }
  return out.map(fixArticles);
}

/** A pattern that matches exactly the fillings of one entry, each slot from its own list. */
function fillingPattern(entry) {
  const escape = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const body = entry
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      return m ? `(?:${EXAMPLE_SLOTS[m[1]].map(escape).join('|')})` : escape(part);
    })
    .join('')
    .replace(/(^| )an? /g, '$1an? ');
  return new RegExp(`^${body}$`);
}

test('there are about 1000 base entries, all different', () => {
  assert.ok(EXAMPLES.length >= 900 && EXAMPLES.length <= 1100, `${EXAMPLES.length} entries`);
  const seen = new Set();
  for (const e of EXAMPLES) {
    const key = e.toLowerCase();
    assert.ok(!seen.has(key), `duplicate: ${e}`);
    seen.add(key);
  }
});

test('every entry with no slots reads after "build me" and fits the box', () => {
  for (const e of EXAMPLES.filter((e) => !e.includes('{'))) {
    checkStyle(e, 'base entry');
    assert.equal(fixArticles(e), e, `fixArticles would change it: ${e}`);
  }
});

test('every slot is a known one, and an entry with slots fits the box in most fillings', () => {
  for (const e of EXAMPLES) {
    const names = slotsOf(e);
    for (const name of names) assert.ok(EXAMPLE_SLOTS[name], `unknown slot {${name}} in: ${e}`);
    assert.equal(new Set(names).size, names.length, `the same slot twice in: ${e}`);
    if (!names.length) continue;
    assert.match(e, /^an? /, `does not start with "a " or "an ": ${e}`);
    const fillings = allFillings(e);
    const fit = fillings.filter((f) => f.length <= EXAMPLE_MAX_LENGTH).length;
    assert.ok(fit / fillings.length >= 0.5, `only ${fit} of ${fillings.length} fillings fit: ${e}`);
  }
});

test('each word list has 20 to 60 different words, each number list a sensible few, all used', () => {
  for (const [name, words] of Object.entries(EXAMPLE_SLOTS)) {
    const isNumber = EXAMPLE_NUMBER_SLOTS.includes(name);
    if (isNumber) assert.ok(words.length >= 3 && words.length <= 20, `{${name}} has ${words.length}`);
    else assert.ok(words.length >= 20 && words.length <= 60, `{${name}} has ${words.length} words`);
    assert.equal(new Set(words).size, words.length, `{${name}} repeats a word`);
    for (const w of words) {
      assert.equal(w, w.trim(), `stray spaces in {${name}}: "${w}"`);
      assert.doesNotMatch(w, /[{}]/, `{${name}} word holds a slot: ${w}`);
    }
    assert.ok(EXAMPLES.some((e) => e.includes(`{${name}}`)), `no entry uses {${name}}`);
  }
  for (const name of EXAMPLE_NUMBER_SLOTS) assert.ok(EXAMPLE_SLOTS[name], `no list for {${name}}`);
});

test('a filled slot only ever takes a word from its own list', () => {
  const random = seeded(11);
  for (const e of EXAMPLES.filter((e) => e.includes('{'))) {
    const pattern = fillingPattern(e);
    for (let i = 0; i < 30; i++) {
      const text = fillExample(e, EXAMPLE_SLOTS, random);
      assert.match(text, pattern, `"${text}" is not a filling of: ${e}`);
    }
  }
});

test('a few thousand generated examples follow the style rules, with no repeats, and their reels fit', () => {
  for (const seed of [1, 7, 42, 2026]) {
    const next = exampleGenerator(EXAMPLES, EXAMPLE_SLOTS, seeded(seed));
    const recent = [];
    for (let i = 0; i < 1500; i++) {
      const { entry, text, parts, reels } = next();
      const where = `seed ${seed}, example ${i}`;
      checkStyle(text, where);
      const slotted = entry.includes('{');
      assert.equal(slotted, (i + 1) % EXAMPLE_SLOTTED_EVERY === 0, `slots or not out of turn: ${entry} (${where})`);
      // The fixed text and the slot words, taking turns, make up the example.
      assert.equal(parts.join(''), text, `parts of: ${text}`);
      const names = slotsOf(entry);
      assert.equal(parts.length, 2 * names.length + 1, `parts of: ${text}`);
      assert.equal(reels.length, names.length, `reels for: ${entry}`);
      names.forEach((name, k) => {
        const word = parts[2 * k + 1];
        const reel = reels[k];
        assert.ok(EXAMPLE_SLOTS[name].includes(word), `"${word}" is not a {${name}} word (${text})`);
        assert.equal(reel.length, EXAMPLE_REEL_WORDS + 1, `reel length for {${name}}`);
        assert.equal(reel.at(-1), word, `the reel for {${name}} does not land on "${word}"`);
        for (const w of reel) assert.ok(EXAMPLE_SLOTS[name].includes(w), `"${w}" on the {${name}} reel`);
      });
      assert.ok(!recent.includes(text), `"${text}" again within ${recent.length} (seed ${seed})`);
      recent.push(text);
      if (recent.length > 300) recent.shift();
    }
  }
});

test('the generator also works with the real random source', () => {
  const next = exampleGenerator();
  let previous;
  for (let i = 0; i < 2000; i++) {
    const { text } = next();
    checkStyle(text, `Math.random, example ${i}`);
    assert.notEqual(text, previous, 'the same example twice in a row');
    previous = text;
  }
});

test('fixArticles sets a/an by sound', () => {
  const cases = {
    'a ocean themed snake game': 'an ocean themed snake game',
    'an dinosaur memory game': 'a dinosaur memory game',
    'a 8x8 pixel editor': 'an 8x8 pixel editor',
    'an 16-step drum machine': 'a 16-step drum machine',
    'a 18-hole golf game': 'an 18-hole golf game',
    'an unicorn parade': 'a unicorn parade',
    'a umbrella game': 'an umbrella game',
    'a SVG editor': 'an SVG editor',
    'an CSV viewer': 'a CSV viewer',
    'an MIDI piano': 'a MIDI piano',
    'a hour timer': 'an hour timer',
    'a game about a owl and a otter': 'a game about an owl and an otter',
    'a 3D maze': 'a 3D maze',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(fixArticles(input), want, input);
});

test('a slot with no word list is left as it is', () => {
  assert.equal(fillExample('a {nothing} game', {}), 'a {nothing} game');
});

test('the generator re-rolls a filling that is too long, and skips an entry that is', () => {
  const slots = { word: ['tiny', 'x'.repeat(EXAMPLE_MAX_LENGTH)] };
  const long = `a ${'y'.repeat(EXAMPLE_MAX_LENGTH)}`;
  const next = exampleGenerator(['a {word} game', long, 'a short one'], slots, seeded(5));
  const shows = Array.from({ length: 30 }, () => next());
  const shown = shows.map((show) => show.text);
  for (const text of shown) assert.ok(text.length <= EXAMPLE_MAX_LENGTH, text);
  assert.ok(shown.includes('a tiny game'));
  assert.ok(!shown.includes(long));
});

test('how many examples there are (base entries and distinct filled strings)', (t) => {
  const distinct = new Set();
  for (const e of EXAMPLES) {
    for (const text of allFillings(e)) if (text.length <= EXAMPLE_MAX_LENGTH) distinct.add(text);
  }
  t.diagnostic(`${EXAMPLES.length} base entries, ${EXAMPLES.filter((e) => e.includes('{')).length} with slots`);
  t.diagnostic(`${distinct.size} distinct examples once the slots are filled`);
  assert.ok(distinct.size >= 10 * EXAMPLES.length, `${distinct.size} distinct examples`);
});

test('the cycler shows every entry once per pass, and never the same one twice in a row', () => {
  for (const seed of [1, 7, 42, 2026]) {
    const next = exampleCycler(EXAMPLES, seeded(seed));
    let previous;
    for (let pass = 0; pass < 5; pass++) {
      const shown = [];
      for (let i = 0; i < EXAMPLES.length; i++) {
        const e = next();
        assert.notEqual(e, previous, `same entry twice in a row (seed ${seed}, pass ${pass})`);
        shown.push((previous = e));
      }
      assert.deepEqual([...shown].sort(), [...EXAMPLES].sort(), `pass ${pass} is not every entry once`);
    }
  }
});

test('the order is shuffled, not the list order', () => {
  const next = exampleCycler(EXAMPLES, seeded(3));
  const first = EXAMPLES.map(() => next());
  assert.notDeepEqual(first, [...EXAMPLES]);
});

test('a reshuffle that would repeat the last entry moves it out of the first slot', () => {
  // With two entries, 0.9 leaves the first pass in list order and 0 swaps the second, so
  // it starts with what the first ended on, unless the cycler steps in.
  const randoms = [0.9, 0];
  const next = exampleCycler(['a one', 'a two'], () => randoms.shift() ?? 0.5);
  const shown = Array.from({ length: 8 }, () => next());
  for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], shown.join(', '));
});

test('a new example every second and a half, its reels settled for half of that', () => {
  assert.equal(EXAMPLE_PACE, 1500);
  const most = Math.max(...EXAMPLES.map((e) => slotsOf(e).length));
  assert.ok(most <= 2, `an entry with ${most} slots`);
  // The fade in, then the last reel's roll; settled for at least half the time it shows.
  const settled = EXAMPLE_FADE_MS + EXAMPLE_ROLL_MS + (most - 1) * EXAMPLE_REEL_STAGGER_MS;
  assert.ok(EXAMPLE_PACE - settled >= EXAMPLE_PACE / 2, `the example is settled ${settled} ms in`);
});

test('a reel rolls past different words, never the same twice running, onto its word', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const reel = reelWords('a', 'p', { a: ['p', 'q', 'r'] }, seeded(seed));
    assert.equal(reel.length, EXAMPLE_REEL_WORDS + 1);
    assert.equal(reel.at(-1), 'p');
    for (let k = 1; k < reel.length; k++) assert.notEqual(reel[k], reel[k - 1], reel.join(' '));
  }
});

test('the parts of an example: fixed text and slot words in turn, articles fixed for the words', () => {
  assert.deepEqual([...exampleParts('a {theme} themed snake game', ['ocean'])], ['an ', 'ocean', ' themed snake game']);
  assert.deepEqual([...exampleParts('a {style} {theme} platformer', ['8-bit', 'jungle'])], ['an ', '8-bit', ' ', 'jungle', ' platformer']);
  assert.deepEqual([...exampleParts('a plain one', [])], ['a plain one']);
});
