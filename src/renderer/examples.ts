// The "build me" box's placeholder examples, and the shuffled order they cycle in. A plain
// script (no imports, no DOM use of its own) that loads before renderer.ts, so
// test/examples.test.mjs can run it under Node.
// Each entry reads after "build me": lowercase, "a"/"an" first, short enough for the box,
// and something one headless run of 10 to 30 minutes can build with no accounts, API keys,
// paid services or server. No brand names.

const EXAMPLES: readonly string[] = [
  // Small web apps and tools
  'a markdown editor with live preview',
  'a kanban board that saves to local storage',
  'a regex tester with match highlighting',
  'a colour palette generator with hex codes',
  'a JSON formatter and validator',
  'a password generator with a strength meter',
  'a split-the-bill calculator with tips',
  'a recipe scaler that converts units',
  'a loan repayment calculator with a chart',
  'a flashcard app with spaced repetition',
  'a typing speed test with random quotes',
  'a CSS gradient builder with copyable code',
  'a diff viewer for two blocks of text',
  'a time zone meeting planner',
  'a personal start page with a clock and links',

  // Productivity and personal trackers
  'a habit tracker with a yearly heatmap',
  'a budget tracker with category pie charts',
  'a workout log that tracks personal records',
  'a mood journal with a monthly calendar view',
  'a sleep log that charts weekly averages',
  'a study timer with focus and break cycles',
  'a reading log with star ratings',
  'a meal planner with an automatic shopping list',
  'a chore rota for a shared house',

  // Browser games, 2D
  'a snake game with power-ups',
  'a falling-block puzzle game with a hold slot',
  'a four-in-a-row game against the computer',
  'a memory card matching game with emoji',
  'a minefield puzzle with three difficulty levels',
  'a platformer with three hand-made levels',
  'a space shooter with waves of enemies',
  'a tower defence game on a grid',
  'a sliding number puzzle with a move counter',
  'a chess board for two players on one screen',
  'a solitaire card game with drag and drop',
  'a hangman game with themed word lists',
  'a brick-breaking paddle game',
  'a tic-tac-toe game with an unbeatable AI',
  'a code-breaking peg game with hints',
  'an endless runner with a jumping cat',
  'a box-pushing puzzle with ten levels',
  'a whack-a-mole game that keeps speeding up',
  'a rhythm game where you tap to the beat',
  'a lunar lander game with fuel and gravity',
  'a mini golf game with ten holes',

  // Browser games and scenes, simple 3D
  'a first-person 3D maze with a timer',
  'a 3D marble game on a tilting board',
  'a 3D solar system you can orbit and zoom',
  'a 3D terrain flyover made from random noise',
  'a voxel sandbox for stacking coloured blocks',

  // Command-line tools and utilities
  'a command-line tool that renames photos by date',
  'a CSV to JSON converter for the command line',
  'a command-line to-do list kept in a text file',
  'a duplicate file finder for a folder',
  'a script that resizes every image in a folder',
  'a command-line dice roller with RPG notation',
  'a log file summariser that counts errors',
  'a static site generator for a folder of notes',
  'a command-line system monitor with live bars',
  'a command-line report of a git repo\'s commits',

  // Converters
  'an image to ASCII art converter',
  'a number base converter for binary and hex',
  'a Roman numeral converter that works both ways',
  'a text case converter for camel and snake case',
  'a Morse code translator that beeps',

  // Generators
  'a fantasy character name generator',
  'a pixel art editor with a 32x32 grid',
  'a random dungeon map generator',
  'a printable bingo card generator',
  'a word search maker that prints to PDF',

  // Visualisations and simulations
  'a cellular automaton sandbox you can draw on',
  'a flocking birds simulation with sliders',
  'a gravity sandbox where you fling planets',
  'a sorting algorithm visualiser with sound',
  'a pathfinding visualiser on a drawable grid',
  'a double pendulum simulation',
  'a fractal explorer with zoom and pan',
  'a falling sand game with water and fire',
  'an ant colony simulation with scent trails',
  'a dashboard that charts any CSV you drop in',

  // Educational toys
  'a times tables quiz with a high score',
  'a periodic table you can click to explore',
  'a capital cities quiz with a streak counter',
  'a binary counting toy with flip switches',
  'a fraction visualiser with pie slices',
  'an interactive clock for learning to tell time',

  // Creative and music toys
  'a metronome with tap tempo',
  'a drum machine with a 16-step sequencer',
  'a synth you play with the computer keyboard',
  'a generative art poster maker',
  'a kaleidoscope drawing toy',
  'a spinning-gear curve drawing toy',
  'a chord progression generator with playback',
  'a white noise mixer with rain and fan sounds',

  // A few fun or silly ones
  'a virtual pet that gets hungry over time',
  'a compliment generator with one big button',
  'an excuse generator for being late',
  'a magic eight ball you can shake',
  'a cat that chases your cursor around the page',
  'a spinning decision wheel with custom options',
  'a page of bubble wrap to pop',
];

/** Hands out the examples in a random order: a fresh shuffle (Fisher-Yates) each pass, every
 *  entry once per pass, and never the same one twice in a row across a reshuffle. */
function exampleCycler(list: readonly string[], random: () => number = Math.random): () => string {
  let deck: string[] = [];
  let next = 0;
  return () => {
    if (next >= deck.length) {
      const last = deck[deck.length - 1];
      deck = [...list];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      if (deck.length > 1 && deck[0] === last) {
        const j = 1 + Math.floor(random() * (deck.length - 1));
        [deck[0], deck[j]] = [deck[j], deck[0]];
      }
      next = 0;
    }
    return deck[next++];
  };
}
