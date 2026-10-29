# software2

`software(2);`

A proof-of-concept Windows app with one text box that reads "build me [ ... ]". You type the software you want,
the app asks Claude Code for a quick time estimate, you confirm and pick a new
folder, and Claude Code builds it in one go, headless, with local git only.

Behind the scenes it just pipes your request, plus some instructions, into the
`claude` CLI. Windows only for now.

Status: works end to end with the fake CLI (see the tests). The first run with the
real Claude Code is still to be done.

**Real builds use your own Claude Code login and count against your own plan's usage**
(or your API billing, if that is how your Claude Code is signed in). A build can run
for as long as the time cap in Settings (30 minutes by default), or the max run time set
for that build under Advanced.

| Start (light theme) | Start (dark theme) |
| --- | --- |
| ![The start page](docs/screenshots/light-empty.png) | ![The start page, dark](docs/screenshots/dark-empty.png) |

## How to use it

1. Finish the sentence "build me ...", for example "a to-do list web page", and press
   **Enter** or **Go** (Shift+Enter starts a new line). What is sent on is "Build me "
   plus what you typed.
2. Optional: **Advanced** (the sliders button next to Go) opens a small panel for this
   build only. It is closed whenever the app opens and nothing in it is saved:
   - **Max run time**, 5 to 120 minutes. Empty: the build time cap from Settings.
   - **Design style**, in your own words ("dark and minimal", "like a 90s website").
     It goes to the estimate and to the build as the design direction; empty lets
     Claude choose.
   - **Files**: drop them anywhere on the window or use **Add files**; folders are
     refused, and they can add up to 200 MB. They are copied into an `assets` folder in
     the new project (names kept, clashes numbered) and committed before Claude starts,
     and Claude is told they are yours to use in the project (photos of your cat for a
     cat website, say). The estimate only hears their names, types and sizes. The app
     only copies them: it never opens or uploads them anywhere.

   When anything is set, a chip in the box says so ("45 min · dark and minimal ·
   3 files"), with the panel open or closed. **Build something else** clears it.
3. Read the estimate and press **Build it**, then pick or create a new, empty folder.
4. Watch the status line under the text box: what Claude is doing right now, the time
   against the estimate and a thin progress bar. **Stop** kills the build at any time;
   the time cap kills it too.
5. When it ends you get Claude's summary, the git commits it made, **Open folder**,
   **Open README**, **Open full log** (to see what went wrong in a failed run) and
   **Build something else**. There is no history of past builds: their folders stay
   where you put them.

The window follows the Windows light or dark theme. Its cards are frosted glass over a
slowly drifting colour background that reacts to what is going on: calm when idle,
livelier while estimating and building, a green bloom when a build is done and a muted
red when it failed or was stopped. With Windows' "Show animations" turned off
(prefers-reduced-motion) the background stands still. It pauses while the window is
minimised; idle, it uses about a tenth of one CPU core.

The window has its own slim title bar (drag it, double-click to maximise, snap works).
**Escape** closes Settings and cancels the estimate card.

| Advanced, open (light theme) | Advanced, open (dark theme) |
| --- | --- |
| ![The Advanced panel with a run time, a design style and three files](docs/screenshots/light-advanced.png) | ![The Advanced panel, dark](docs/screenshots/dark-advanced.png) |

| Estimate | Building |
| --- | --- |
| ![The estimate card](docs/screenshots/light-confirm.png) | ![Building, the status line](docs/screenshots/light-building.png) |

| Result (dark theme) | A failed build |
| --- | --- |
| ![A finished build](docs/screenshots/dark-done.png) | ![A failed build, with Open full log](docs/screenshots/light-failed.png) |

## About "build without asking permission"

The setting **Let Claude build without asking permission** is on by default. It passes
`--dangerously-skip-permissions`, which means: Claude can run any command on this PC
with your user's rights, without asking. It is told to stay inside the project folder,
but nothing enforces that. It could delete files elsewhere, install things, or use
the network. Only use it for requests you trust, and ideally on a PC or user account
without anything precious on it.

When it is off, the build runs with `--permission-mode acceptEdits` and a short
allow-list: Claude can edit files in the project folder and run only `npm`, `npx`,
`node`, `python`, `py`, `pip`, `dotnet` and `git`. Nobody is there to answer a
permission prompt in a headless run, so any other command simply fails and Claude has
to work around it. Some builds will not finish that way.

## What Go does

1. **Estimate** (60 s cap, spinner with the elapsed time): runs
   `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence`
   in a temporary empty folder, so Claude can only answer, not act. The prompt has the
   request, the design style and the files' names, types and sizes (never the files).
   It replies with JSON:
   minutes, summary, stack, steps and risks. Code fences and prose around the JSON are
   fine; if no estimate can be read, the raw reply is shown with Retry.
2. **Confirm**: a card with the summary, stack, steps, "About N minutes", the design
   style and number of files if set, the time cap for this build and, if the
   permission-skip setting is on, a warning. "Build it" or "Cancel".
3. **Folder**: a folder dialog opens at the default folder. Pick or create a new, empty
   folder; a non-empty one is refused. It gets `git init` and an empty first commit.
   Files from Advanced are then copied into `assets` and committed.
4. **Build** (time cap from Advanced, else from Settings): runs
   `claude -p --output-format stream-json --verbose` in the project folder, plus either
   `--dangerously-skip-permissions` or
   `--permission-mode acceptEdits --allowedTools "Bash(npm *)" ...` (see above). The
   prompt goes in through stdin and comes from `prompts/build.md`: the request word for
   word, the design direction, the files in `assets`, the estimate as a plan, and the rules (only this folder, no questions, commit
   after each step, a README, run the tests, end with a summary). Edit that file to
   change what Claude is told; it is read at every build.
5. **Status line**: one sentence for what Claude is doing now, taken from the stream:
   tool calls become "Writing src/app.js", "Editing ...", "Reading ...",
   "Running npm test" or "Committing: <message>"; Claude's text becomes its first short
   sentence, or "Thinking...". Updates are throttled so it does not flicker. Next to it:
   the elapsed time against the estimate ("3:12 of ~10 min", then "taking longer than
   estimated") and a progress bar.
6. **Full log**: everything (Claude's text, each tool call as one line, the first lines
   of each result, stderr) goes to a file per run, `%APPDATA%\software2\logs\run-*.log`
   (the last 100 runs), opened with **Open full log** on the result card.
7. **Result**: done, stopped, failed or timed out, shown on the result card. It is not
   saved anywhere else (an old `history.json` from earlier versions is left alone and
   no longer read).

## Run it in dev

Needs Node 22 or newer and the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)
installed and signed in (only for real use; the tests never call it).

```
npm install
npm start
```

`npm start` compiles the TypeScript into `dist/` and opens the window. If Electron
says it failed to install correctly, its download step was skipped; run
`node node_modules/electron/install.js` once.

```
npm test
```

builds and runs the tests (`node:test`). They use `test/fake-claude.mjs`, a tiny
stand-in for the CLI, never the real one.

### Demo mode and screenshots

Off by default. `SOFTWARE2_DEMO=1` runs the window against `test/fake-claude.mjs`, with
a throwaway data folder in `%TEMP%\software2-demo-*` (your real settings are not
touched) and no folder dialog. `SOFTWARE2_SHOTS=<folder>` also walks through every
state (empty, the Advanced panel with three made-up sample files, open and closed,
estimating, confirm, building, done, Settings, a failed build, the smallest window,
reduced motion) in light and dark, saves a PNG of each into that folder, writes
the idle CPU use (window shown, minimised, reduced motion) to `cpu-idle.txt` there and
quits. Page errors and warnings are printed in the terminal. In Git Bash, after `npm run build`:

```
SOFTWARE2_SHOTS=shots node_modules/electron/dist/electron.exe .
```

`SOFTWARE2_THEME=light|dark` forces a theme in plain demo mode.

## Settings

Open **Settings** with the gear icon. They are saved as JSON in the app's own folder,
`%APPDATA%\software2\settings.json`:

- **Claude CLI**: path to `claude.exe` or `claude.cmd`. Found on PATH automatically;
  use Detect or Browse to change it. A `.js`/`.mjs` script also works (it is run
  with Node), so you can point it at `test/fake-claude.mjs` to try the app without
  Claude.
- **Default folder for new projects.**
- **Build time cap** in minutes (default 30). The build is killed when it runs out.
- **Let Claude build without asking permission** (`--dangerously-skip-permissions`),
  on by default. See above for what that means and what happens when it is off.

## Layout

```
src/main/main.ts        Electron main process: window, IPC, settings, Go/Stop
src/main/runner.ts      runClaude(): spawn the CLI, stream lines, Stop, time cap
src/main/settings.ts    load/save settings.json, find claude on PATH
src/main/flow.ts        Go: estimate -> confirm -> folder -> build (Electron bits passed in)
src/main/advanced.ts    Advanced: run time, design style, files (checks, copy into assets/)
src/main/estimate.ts    the estimate run and parsing its JSON reply
src/main/project.ts     the empty-folder check and git init
src/main/build.ts       runBuild(): the build run, its flags and its prompt
src/main/stream.ts      stream-json lines -> readable log lines and the status-line sentence
src/main/runlog.ts      the full log file per run (userData\logs)
src/main/demo.ts        demo mode and the screenshot walk-through (off by default)
prompts/build.md        the build prompt (editable)
src/preload/preload.ts  the small window.api the page gets
src/renderer/           index.html, styles.css, renderer.ts (plain script, no framework),
                        background.ts (the animated background)
src/api.d.ts            types for window.api
test/fake-claude.mjs    fake claude CLI for tests
test/*.test.mjs         tests (run against the compiled dist/)
docs/screenshots/       screenshots from the demo mode
assets/                 the app icon: icon.svg, rendered to icon.png and icon.ico
scripts/make-icon.mjs   renders the icon (run it with Electron, see the file)
```

## Build a Windows exe (later)

Not set up yet. The plan is [electron-builder](https://www.electron.build/) as a dev
dependency with a `dist` script, for example `electron-builder --win portable`, which
writes a single `.exe` into `release/`.
