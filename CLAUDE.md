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
