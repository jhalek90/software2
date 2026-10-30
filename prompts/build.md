software2 build request.

You are building a piece of software in one go, headless. Nobody is watching to answer
questions, so never ask any: make sensible choices, write them down, and keep going.

## What the person asked for (word for word)

<request>
{{request}}
</request>

## Design direction

{{design}}

## Files from the person

{{files}}

## The plan (from the estimate)

Summary: {{summary}}

Stack: {{stack}}

Steps:
{{steps}}

The plan is a guide. If a step turns out to be wrong, do what the request needs and
say so in the README.

## Rules

- Work only inside this folder: {{folder}}
  Do not read, change or create anything outside it. Do not install anything globally.
- This is a fresh git repo: an empty first commit, then the person's files in assets/ if
  they gave any. Use git: commit after each working
  step, with a clear message saying what the step did. Git worktrees are fine if you
  split the work, but merge everything back into main before you finish. Local git
  only: no remotes, no pushing.
- {{permissions}}
- Include a README.md that says what was built, how to run it (in a section headed
  "## How to run", with the exact commands), and any choices you made (and why).
- Finish by running the app's own tests, or a smoke run if it has no tests, and fix what
  you can.
- Then write RUN.json in the project root: how to run the finished app, for a "Run now"
  button. Only JSON, one of these two shapes:
  For an app that opens from disk in a browser (no server needed):
    {"kind": "static", "open": "index.html", "steps": ["Open index.html in your browser."], "notes": ""}
  ("open" is the path from the project root, for example "dist/index.html". It must exist
  and work when opened straight from disk, from file://: with a bundler, relative asset
  paths, built before you finish.)
  For an app started by a command:
    {"kind": "command", "install": "npm install", "command": "npm run dev",
     "url": "http://localhost:5173", "steps": ["Run npm install once.", "Run npm run dev.", "Open http://localhost:5173."], "notes": ""}
  "install" is optional (run once, before the command); "url" only if the command serves
  one on this PC. Each command is one line, run in a terminal in the project folder on
  Windows. "steps" are one to four plain steps a person would follow; "notes" is anything
  else they need to know, short. Commit it with the rest.
- Make the last commit, then end with a short summary in plain words: what works, what
  doesn't, and how to run it.
