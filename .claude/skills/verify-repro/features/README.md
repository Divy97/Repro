# Repro verification map

This directory is the maintained source for verifying Repro's user-facing behaviour. Read this index before driving the app, then use the matching feature file as the recipe.

**Every Bash tool call is a fresh shell.** Variables do not survive from one call to the next, so every recipe step must start, from the repository root, with:

```sh
RV=.claude/skills/verify-repro/scripts/repro-verify; E=$($RV evidence)
```

Pass absolute paths to `$RV cli`: it runs with its cwd in the state directory, so a relative path resolves there, not in the checkout. `$E` is already absolute.

## Baseline preconditions

- `$RV up` has printed `"ok": true` and `$RV doctor` passes every check.
- The instance is the empty one `up` creates: no installations, no recipes, no runs, no jobs. A feature that needs more seeds it in its own recipe.
- `E=$($RV evidence)` holds this run's evidence directory.
- Never drive an instance this run did not start, and never use `.env` or an npm script that loads it (see SKILL.md, Safety).

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise. Recipes may share one instance if each restores what it changed, or the order is stated.
- Deliveries are real GitHub payload shapes, written to `$E/<feature>-<what>.json` first so the bytes sent are part of the evidence, then sent with `$RV webhook <x-github-event> <file>`.
- Browser actions go through `$RV browse`; terminal actions through `$RV cli`; observations of stored state through `$RV sql` (read-only).
- Wait for data, not for headings. Put a positive `wait` before every `absent`. Patterns are case-insensitive because the stylesheet uppercases headings, tabs and buttons.
- Use `fill`, never anything that assigns `.value` directly, for inputs: React ignores a direct assignment. That includes `src/browser.ts`'s own `Browser.type`, a product bug noted in `onboard-repository.md`.

## Proof and skip reporting

- UI proof is a `shot` and a `text` of the resulting state, plus the `browse` JSON showing `"console": ["nothing logged"]`.
- Delivery proof is the JSON `$RV webhook` prints (`status` and `body`), the service log lines (`$RV logs`), and the stored row (`$RV sql`).
- CLI proof is the command, its stdout and stderr, and its exit code.
- Every mutation is confirmed from a second view: a delivery from the dashboard and the database, a dashboard action from the database and the log.
- Record the feature ID and the entry point with each artifact by naming it `<feature>-<step>-<what>`.
- A journey that reaches `api.github.com` cannot complete locally, because the App is fake and answers 401. Report it as **unverifiable here**, quote the log line that shows where it stopped, and never report it verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behaviour, then exactly four H2 sections in this order:

1. `Sub-features`: short IDs, one line each.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with repro-verify`: starts with `Preconditions:`, then labelled bullets pairing each action with an exact command and its observable result.
4. `Gotchas`: traps that waste or invalidate a run.

## Features

- [Connect a repository](./connect-repository.md): a signed GitHub install or uninstall delivery adds or removes a repository on the dashboard. Every step verified on 2026-10-24 (the skill's end-to-end proof).
- [Onboard a repository](./onboard-repository.md): write or review the commands a repository runs with, and approve them. The refusals were verified. Approval triggers a GitHub call and was not run.
- [Read a run's evidence](./run-evidence.md): the run register and the evidence page (tier, both arms, timeline, cost) for a finished run. Every step verified.
- [Issue intake](./issue-intake.md): what a signed `issues` delivery does on an uninstalled, un-onboarded or onboarded repository. The local paths were verified; the GitHub-bound paths were not run.
- [Replay and rebuild from the log](./cli-replay-rebuild.md): the operator CLI's pure fold of a run and its projection rebuild. Every step verified.

## Surfaces not mapped

- **The control plane** (`src/plane-server.ts`, `npm run plane`). Every page is behind GitHub OAuth (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ENGINE_PLANE_CALLBACK_URL`), and its boot reconciles installations against GitHub, so it cannot be signed into locally without a real App. Its routes are the same `src/routes.ts` in `mode: "plane"`, which `test/plane.test.ts` and `test/authz.test.ts` cover with an injected session.
- **The runner and worker** (`npm run runner`, `src/runner-main.ts`). They need a plane URL, a paired runner token, a model key and the sandbox images (`npm run images`).
- **A full engine run** (issue to PR). `src/serve.ts` hardwires `api.github.com` for the token mint, clone and PR, and a real model key is spent, so no complete run is reachable from the local surface. The only local full run is the suite's: `test/run.test.ts` (`shipped-filter`) drives `runFromIssue` with the scripted model server in `test/fixtures/model.ts` (`fakeModel` and `fakeChat`, real HTTP servers on a local port), a bare git remote on disk, and a recording `fetch` for GitHub. It builds its own `test-framework-v2-sandbox:test` image (minutes) and needs Docker but no database: `npx vitest run test/run.test.ts -t shipped-filter`. `vitest.config.ts` loads `.env` from the working directory, so run it from a checkout with no `.env`.
