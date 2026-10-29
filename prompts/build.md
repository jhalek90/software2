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
- Include a README.md that says what was built, how to run it, and any choices you made
  (and why).
- Finish by running the app's own tests, or a smoke run if it has no tests, and fix what
  you can.
- Make the last commit, then end with a short summary in plain words: what works, what
  doesn't, and how to run it.
