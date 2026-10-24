# Working in Repro

This repository is built with [pstack](https://github.com/cursor/plugins/tree/main/pstack). This file holds only what pstack can't know about Repro. The rules for how to work live in pstack itself.

## Start every non-trivial task with `/pstack:poteto-mode`

- `poteto-mode` matches the task to a playbook, copies its steps into the todo list, and runs the other pstack skills as the steps need them. A small, obvious edit does not need it.
- pstack skills are user-invoked only, so the model never sees them in its skill list. To run one inside a step, read `<pstack>/skills/<name>/SKILL.md` and follow it. `<pstack>` is the installed plugin, under `~/.claude/plugins/cache/cursor-plugins/pstack/`. Read `<pstack>/docs/harness/claude-code.md` once per session; it maps Cursor names to Claude Code.
- pstack is the only workflow in this repo. The older workflow plugins and skills (superpowers, compound-engineering, feature-dev, pr-review-toolkit, standalone `tdd` and `grill-me`) are switched off in `.claude/settings.local.json`. Do not add brainstorming or plan-document steps. pstack plans through code: the Prototype playbook and `architect`. It writes a plan only through the multi-phase-plan playbook, after the design settles.
- Model roles come from `~/.claude/rules/pstack-models.md`. Claude Code has no Grok, so code roles run on the session model and review panels pair Opus with Sonnet.

## Prove behavior with `/verify-repro`

- `.claude/skills/verify-repro/` is this repo's control skill. When a pstack step names a control skill, `control-ui`, `control-cli`, or `/control-app`, use it.
- A green `npx vitest run` is a proxy. A change is done when its behavior was observed through `verify-repro` or the real command, and the reply carries that evidence.
- Agents in the suite are scripted, so the suite cannot validate a prompt. A change to `prompts/`, or to any string the engine matches against agent output, needs a real model run (`scripts/real-run.mts`). The OpenRouter key is spent, so report such a change as inconclusive, never as done.
- When you add a field the Runner reads, check every Job template that builds a container (`grep -rn "const job: Job = {" src`), then observe the value inside the container that judges, not the agent's sandbox.

## Pause before these, even mid-autonomy

pstack's Autonomy section lets reversible work proceed without asking. Here, also pause for:

- Anything that reads `.env`. Its `DATABASE_URL` is the production Neon database, and a live worker claims every queued job. The npm scripts with `--env-file=.env` (`db:apply`, `seed`, `replay`, `status`, `rebuild`, `reconcile`, `worker:pair`, `worker:unpair`) run against production. Run database-backed tests against a local Postgres with the env from `.github/workflows/check.yml`.
- `fly deploy`, `npm run images:push`, and any GitHub App action against a real repository.

## Git

- A subagent that edits or mutation-tests code gets `isolation: "worktree"`. That is the Claude Code form of pstack's `environment: "cloud"`.
- Stage explicit paths and read `git diff --cached` before every commit. Never `git add -A` or `git commit -a`. A mutation reviewer's removed security guard was once committed and pushed that way.
- Commit before every mutation control. `git checkout -- <file>` restores HEAD, not the state before the mutation, and it has deleted uncommitted fixes four times.
- Commit and PR titles use Conventional Commits, per pstack's Opening a PR playbook.
- No `Co-Authored-By` trailer and no "Generated with" line in any commit or PR body.

## Review

- pstack's Opening a PR runs `interrogate` and `no-comments`. `/deslop` ships in cursor-team-kit, which the Claude Code marketplace does not list. Read `~/.claude/plugins/marketplaces/cursor-plugins/cursor-team-kit/skills/deslop/SKILL.md` instead.
- Every security test pairs with a negative control: remove the defence and show the attack succeeds.
- A change to the verification gate or the sandbox boundary gets a fresh `interrogate` after every fix round. Past fixes there opened new holes twice.
