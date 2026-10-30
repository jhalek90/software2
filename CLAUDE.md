# software2: notes for agents working on this repo

Electron + TypeScript, plain HTML/CSS renderer, Windows only. See README.md for the layout.

## Rules

- Never launch the real `claude` CLI or any Claude Code session from here, not even to
  test. Tests and manual tries use `test/fake-claude.mjs` (set it as the Claude CLI path
  in Settings to try the app). Detecting claude on PATH only checks files; keep it that way.
- Never touch `~/.claude` or other apps' data folders. The app's own data is `%APPDATA%\software2`.
- No global installs. Don't publish or deploy.

## Project notes

- `npm test` builds first; tests import the compiled CommonJS from `dist/`, so add new tests as `test/*.test.mjs`.
- All CLI calls go through `runClaude()` in `src/main/runner.ts` (main.ts `startRun()` wires it to the log). Pass the prompt via stdin, not args: args to a `.cmd` shim go through cmd.exe and `%`, `!`, `"` and newlines are refused.
- New fake-CLI behaviour goes in `test/fake-claude.mjs`, switched by `FAKE_CLAUDE_*` env vars (see its header).
- The renderer is a plain script (`moduleDetection: legacy` in tsconfig): no imports in `src/renderer/*.ts`; shared types go in `src/api.d.ts`.
- npm may skip Electron's download on install; `node node_modules/electron/install.js` fixes "Electron failed to install correctly".
- `Flow` (`src/main/flow.ts`) gets the Electron parts (dialogs, log, status) as deps so the whole Go flow is tested under Node; the build plugs in at `runBuild()` in `src/main/build.ts`.
- `--tools ""` (empty string) is how the CLI turns off all built-in tools; the estimate relies on it, and an empty arg is fine through the `.cmd` quoting.
- Build flags are `buildArgs()` in `src/main/build.ts`; the build prompt is `prompts/build.md`, read at every build (CRLF on a Windows checkout, so it is normalised). Its first line "software2 build request." is what makes the fake CLI do its tiny build; keep it.
- New project repos are `git init --initial-branch=main`; the build prompt tells Claude to merge back into main.
- Tests don't need the Electron binary: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` is enough for `npm test` in a fresh worktree.
- The window has no log view: the status line sentence is `ParsedLine.activity` (`src/main/stream.ts`) sent via `onActivity`, and the full log goes to `userData\logs\run-*.log` (`src/main/runlog.ts`). The renderer maps flow.ts's `setStatus` words in `onStatus()`, so rewording those needs the renderer too.
- Check UI changes visually with `SOFTWARE2_SHOTS=<dir>` (demo mode: fake CLI, temp userData, every state in light and dark), then Read the PNGs. In Electron, `rmSync` fails on git's read-only object files; clear the read-only bit first.
- No build history, on purpose (the user removed it). The result card's Open folder/README/log act on `lastBuild` in main.ts; the page never passes a path.
- The disclaimer `<footer class="disclaimer">` is the body column's last flex item, not `position: fixed`, so `main` scrolls above it and nothing overlaps; its `--text-faint` is picked for 4.7:1 or more on the animated background's bottom edge (background.ts fades it back to `--bg`), so recheck it if the background changes. Shots mode also takes `narrow-*` shots at the 600x480 minimum.
- The window is frameless (`frame: false`): the title bar is `.titlebar` in index.html, `-webkit-app-region: drag` on the bar and `no-drag` on its buttons; window buttons go through `window:control` IPC.
- `src/renderer/background.ts` loads before renderer.ts and exposes one global, `backdrop` (`setScene`, `setProgress`); the renderer calls `setScene` at each state change. Keep the canvas at full size: a scaled-up small canvas shows the gradient dithering as a grid and costs no less.
- Shots mode turns off Chromium's window-occlusion detection so the idle CPU figure is taken with the background running; use `cumulativeCPUUsage` for CPU (`percentCPUUsage` is divided by the core count).
- The request is "Build me " + what was typed (`buildMeRequest()` in flow.ts). Advanced's options travel with `estimate()` and are re-checked in main (`checkOptions()` in `src/main/advanced.ts`); the renderer's copies of the limits (5-120 min, 200 MB) must match it. Advanced is never saved, on purpose.
- Supplied files are copied into `assets/` and committed after git init, so the build's commit list (from HEAD at build start) leaves that commit out. The estimate gets names/types/sizes only; `FAKE_CLAUDE_PROMPT_FILE` lets tests read the prompt the fake got.
- After editing `assets/icon.svg`, rerun `node_modules/electron/dist/electron.exe scripts/make-icon.mjs` for the PNG/ICO.
- Which of the box, the "Building: ..." line and the result card show is `src/renderer/view.ts` (`nextView`/`applyView`, a plain script loaded before renderer.ts and run in a vm by `test/view.test.mjs`); status words that move views must match flow.ts. A part that folds its height inside `.stage` (a flex column) needs `min-height: 0`, or the fold stops at its content's height.
- The no-terminal way to open the app is `scripts/launch.vbs` (desktop shortcut via `npm run shortcut`) -> `scripts/launch.mjs` (`npm run launch`): build, then spawn `node_modules/electron/dist/electron.exe` detached, dropping `ELECTRON_RUN_AS_NODE`. Exit codes 1/2 pick launch.vbs's message; the log is `%TEMP%\software2-launch.log`. `.vbs` files are kept CRLF by `.gitattributes`.
- "How to run it" is `src/main/howtorun.ts`: `readHowToRun()` (RUN.json, else the README's "How to run" section) goes on a done `BuildOutcome.howToRun`; Run now (`RunNow`) only runs that spec, opening a `.cmd` from `userData\run` with `shell.openPath` (a visible console), after a first-time confirm kept in memory. Tests stub the launchers; demo mode never runs a command. The fake's `FAKE_CLAUDE_RUN` picks what the build leaves (static/command/broken/readme).
- The "build me" placeholder examples are `EXAMPLES` in `src/renderer/examples.ts` (a plain script before renderer.ts, shuffled by `exampleCycler()`); `test/examples.test.mjs` holds them to 90-110 entries, unique, "a "/"an " first, at most 60 chars.
