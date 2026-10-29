# software2

A proof-of-concept Windows app with one text box. You type the software you want,
the app asks Claude Code for a quick time estimate, you confirm and pick a new
folder, and Claude Code builds it in one go, headless, with local git only.

Behind the scenes it just pipes your request, plus some instructions, into the
`claude` CLI. Windows only for now.

Status: the app shell, settings and the CLI runner are in place. The estimate and
build steps come next.

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

## Settings

Open **Settings** in the window. They are saved as JSON in the app's own folder,
`%APPDATA%\software2\settings.json`:

- **Claude CLI**: path to `claude.exe` or `claude.cmd`. Found on PATH automatically;
  use Detect or Browse to change it. A `.js`/`.mjs` script also works (it is run
  with Node), so you can point it at `test/fake-claude.mjs` to try the app without
  Claude.
- **Default folder for new projects.**
- **Build time cap** in minutes (default 30). The build is killed when it runs out.
- **Let Claude build without asking permission** (`--dangerously-skip-permissions`),
  on by default. Claude can then run any command on this PC, in and outside the
  project folder. Only use this for requests you trust.

## Layout

```
src/main/main.ts        Electron main process: window, IPC, settings, Go/Stop
src/main/runner.ts      runClaude(): spawn the CLI, stream lines, Stop, time cap
src/main/settings.ts    load/save settings.json, find claude on PATH
src/preload/preload.ts  the small window.api the page gets
src/renderer/           index.html, styles.css, renderer.ts (plain script, no framework)
src/api.d.ts            types for window.api
test/fake-claude.mjs    fake claude CLI for tests
test/*.test.mjs         tests (run against the compiled dist/)
```

## Build a Windows exe (later)

Not set up yet. The plan is [electron-builder](https://www.electron.build/) as a dev
dependency with a `dist` script, for example `electron-builder --win portable`, which
writes a single `.exe` into `release/`.
