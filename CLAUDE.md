# Working in Repro

This repository is built with [pstack](https://github.com/cursor/plugins/tree/main/pstack). This file holds only what pstack can't know about Repro. The rules for how to work live in pstack itself.

## Install pstack yourself

Run `/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`. This repo was set up against pstack 0.15.32 (`cursor/plugins` commit `9580c23`). The repo does not enable the plugin for you: the marketplace cannot be pinned to a commit, so a committed `enabledPlugins` would trust whatever `cursor/plugins` main holds on the day of the clone. Keep auto-update off and read the upstream diff before you update.

## Start every non-trivial task with `/pstack:poteto-mode`

- `poteto-mode` matches the task to a playbook, copies its steps into the todo list, and runs the other pstack skills as the steps need them. A small, obvious edit does not need it.
- pstack skills are user-invoked only, so the model never sees them in its skill list. To run one inside a step, read `<pstack>/skills/<name>/SKILL.md` and follow it. `<pstack>` is the installed plugin, under `~/.claude/plugins/cache/cursor-plugins/pstack/`. Read `<pstack>/docs/harness/claude-code.md` once per session; it maps Cursor names to Claude Code.
- pstack is the only workflow in this repo. The committed `.claude/settings.json` switches off the older workflow plugins (superpowers, compound-engineering, feature-dev, pr-review-toolkit, code-simplifier, commit-commands, claude-md-management). The standalone `tdd` and `grill-me` skills are per-user, so each developer hides them with `skillOverrides` in their own settings. Do not add brainstorming or plan-document steps. pstack plans through code: the Prototype playbook and `architect`. It writes a plan only through the multi-phase-plan playbook, after the design settles.
- Model roles come from `~/.claude/rules/pstack-models.md`. Claude Code has no Grok, so code roles run on the session model and review panels pair Opus with Sonnet.

## Prove behavior with `/verify-repro`

- `.claude/skills/verify-repro/` is this repo's control skill. When a pstack step calls for a control skill (pstack's `control-ui`/`control-cli` steps, and `/control-app` in poteto's guides), use it.
- A green suite is a proxy. A change is done when its behavior was observed through `verify-repro` or the real command, and the reply carries that evidence.
- Agents in the suite are scripted, so the suite cannot validate a prompt. A change to `prompts/`, or to any string the engine matches against agent output, needs a real model run (`scripts/real-run.mts`). The OpenRouter key is spent, so report such a change as inconclusive, never as done.
- When you add a field the Runner reads, check every Job template that builds a container (`grep -rn "const job: Job = {" src`), then observe the value inside the container that judges, not the agent's sandbox.

## Pause before these, even mid-autonomy

pstack's Autonomy section lets reversible work proceed without asking. Here, also pause for:

- Anything that loads `.env` from its working directory. Its `DATABASE_URL` is the production Neon database, and a live worker claims every queued job. That is:
  - `npm run serve`, `npm run plane` and `npm run runner`: `loadEnv()` in `src/serve.ts`, `src/plane-server.ts` and `src/runner-main.ts`.
  - `scripts/real-run.mts`, `scripts/real-repo-run.mts` and `scripts/live-smoke-vercel.mts`.
  - The eight npm scripts with `--env-file=.env`: `db:apply`, `seed`, `replay`, `status`, `rebuild`, `reconcile`, `worker:pair`, `worker:unpair`.

  The suite is not on this list. `vitest.config.ts` never reads `.env` and refuses a `DATABASE_URL` that is not on this machine. Give it a local Postgres and the rest of the env from `.github/workflows/check.yml`.
- `fly deploy`, `npm run images:push`, and any GitHub App action against a real repository.

## Git

- A subagent that edits or mutation-tests code gets `isolation: "worktree"`. That is the Claude Code form of pstack's `environment: "cloud"`.
- Stage explicit paths and read `git diff --cached` before every commit. `scripts/git-guard.mjs`, a hook in `.claude/settings.json`, refuses `git add -A` and `git commit -a`.
- Run a mutation control with `npx tsx scripts/mutate.mts <file> <find> <replace> -- <test command>`. It restores the bytes the file had. The guard refuses `git checkout -- <paths>`, `git restore` and `git reset --hard`, which restore HEAD and deleted uncommitted fixes four times.
- Commit and PR titles use Conventional Commits, per pstack's Opening a PR playbook.
- No `Co-Authored-By` trailer and no "Generated with" line in any commit or PR body.

## Review

- pstack's Opening a PR runs `interrogate` and `no-comments`. `/deslop` ships in cursor-team-kit, which the Claude Code marketplace does not list. Read `~/.claude/plugins/marketplaces/cursor-plugins/cursor-team-kit/skills/deslop/SKILL.md` instead.
- Every security test pairs with a negative control: remove the defence and show the attack succeeds.
- A change to the verification gate or the sandbox boundary gets a fresh `interrogate` after every fix round. Past fixes there opened new holes twice.

## Rules and what enforces them

When the operator corrects a mistake, fix it and add its rule here. A rule that nothing enforces and that is broken again gets enforced, at the highest level that works, in the same change. Drop a rule once its mistake cannot happen.

| Rule | Enforced by |
| --- | --- |
| The suite never runs against `.env` or a remote database | `vitest.config.ts`: loads no `.env`, throws on a non-loopback `DATABASE_URL` |
| A test that cannot run is reported as skipped, never as passed | `skip()` in `test/fixtures/skip.ts`; `test/no-silent-skip.test.ts` fails on an early `return`; `SkipGate` fails CI on a skip outside `EXPECTED_IN_CI` |
| No new `as never`, `as any`, `as unknown as` or object literal `as` | `scripts/check-casts.mts` in `npm run typecheck`, against `scripts/casts.json` |
| Stage explicit paths, never `git add -A` or `git commit -a` | `scripts/git-guard.mjs` (PreToolUse hook) |
| Revert a mutation with `scripts/mutate.mts`, never a checkout | `scripts/git-guard.mjs` refuses `git checkout --`, `git restore`, `git reset --hard` |
| Read `git diff --cached` before every commit | Nothing |
| The older workflow plugins stay off | `enabledPlugins` in `.claude/settings.json` |
| Start non-trivial work with `/pstack:poteto-mode` | Nothing (judgment) |
| A change is done when `verify-repro` or the real command showed it | Nothing (judgment) |
| A prompt change needs a real model run, or is reported inconclusive | Nothing |
| A field the Runner reads is set in every Job template that needs it | Nothing |
| Pause before `.env`-loading commands, `fly deploy`, `images:push`, GitHub App actions | Nothing |
| A subagent that edits or mutation-tests gets `isolation: "worktree"` | Nothing |
| Conventional Commits titles; no `Co-Authored-By` or "Generated with" line | Nothing |
| Every security test pairs with a negative control | Nothing (judgment) |
| A fresh `interrogate` after each fix round on the gate, the sandbox or a hook | Nothing (judgment) |
