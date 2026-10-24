---
name: verify-repro
description: Launch and drive Repro (this repository) the way its user does. Covers the local dashboard served by src/serve.ts, the GitHub webhook receiver beside it, and the src/cli.ts operator commands, all against a disposable local Postgres. Captures screenshots, page text, database rows and service logs as evidence. Use it to prove that a change to the dashboard, webhook intake, onboarding, the run evidence page or the CLI works in the running app, not only in vitest.
---

# Verify Repro

Repro turns a GitHub issue into a pull request that proves the bug existed before the fix and is gone after. A user touches it through three things:

- **The dashboard** (primary): a Next.js static export in `web/out`, served with a JSON API (`src/routes.ts`) from one port by `src/serve.ts`, the local single-operator deployment. It has no login, `mode: "local"`, and every repository is visible.
- **The webhook receiver**: a second port in the same process. GitHub tells Repro about installs and issues only through signed deliveries, so a signed delivery is the real user path for "connect a repository" and "file an issue".
- **The operator CLI**: `src/cli.ts` (`seed`, `replay`, `rebuild`, `schema`, `recipe show|approve`).

Not drivable locally, and why, is in `features/README.md` under "Surfaces not mapped".

Everything here goes through one helper. Run it from the repository root:

```sh
RV=.claude/skills/verify-repro/scripts/repro-verify
$RV            # usage
```

Every subcommand prints one JSON object and exits non-zero when `"ok": false`. The exceptions are `cli`, `sql`, `logs` and `evidence`, which print raw output.

## Safety: read before anything else

- **The developer's `.env` points `DATABASE_URL` at the PRODUCTION database, and a live production worker claims queued jobs.** Never use `--env-file=.env`. Never run an npm script that loads `.env` (`db:apply`, `seed`, `replay`, `status`, `rebuild`, `reconcile`, `worker:pair`, `worker:unpair`). Use `$RV cli …` instead; it runs `src/cli.ts` against the verification database only.
- `src/serve.ts` calls `process.loadEnvFile('.env')` from its working directory. That call fills every variable not already set, so started from the repository root it would pick up the real GitHub App and model key. `$RV up` therefore starts the service with its cwd in a scratch directory and an environment built from nothing (`env` is not inherited). Do not start `serve.ts` any other way for verification.
- No real model runs. The configured key is the placeholder `repro-verify-placeholder-not-a-key`, and every path that would spend it fails at GitHub first.
- The configured GitHub App does not exist (`GITHUB_APP_ID=repro-verify-no-app`, a freshly generated throwaway key). Some journeys make the service call `api.github.com`, which answers 401. Each feature file says which ones. No push, no PR, nothing reaches a real repository.

## Launch

Prerequisites: Node 22+, a running Docker daemon, and Chrome or Chromium for `browse`. The first run needs the network for `npm ci`, the dashboard build and `docker pull postgres:17`.

```sh
$RV up
```

`up`, from a fresh clone:

1. Runs `npm ci` if `node_modules` is missing (the shim does this).
2. Runs `npm run web:build` if `web/out/index.html` is missing or older than anything in `web/app`, `web/components`, `web/lib`, `web/next.config.mjs` or `web/package-lock.json`.
3. Picks three free ports and starts a dedicated container, `repro-verify-pg-<hash of checkout path>`, from `postgres:17`, published on `127.0.0.1` only and labelled with its state directory.
4. Waits until Postgres answers over TCP. The image's init-time server is socket-only, so this cannot pass mid-init.
5. Applies `db/schema.sql` with `src/cli.ts schema --yes`.
6. Starts `node --import tsx src/serve.ts` detached, logging to `<state>/serve.log`.
7. Returns only when `GET /api/me` answers `200` with `"mode": "local"`.

On any failure it tears down what it started and says what failed.

Ready output (real, from the proof run):

```json
{ "ok": true, "dashboard": "http://127.0.0.1:50475", "webhook": "http://127.0.0.1:50474/",
  "evidence": "<repo>/.verify-evidence/20261024-120514", "pid": 7731,
  "container": "repro-verify-pg-621c5a2c", "ports": { "postgres": 50473, "webhook": 50474, "events": 50475 },
  "schema": "applied", "log": "<tmp>/repro-verify-621c5a2c/serve.log" }
```

The instance starts empty: no installations, no runs, no recipes. Each feature file seeds what its journey needs through user paths (signed deliveries) or the operator CLI.

The state lives in `$TMPDIR/repro-verify-<hash>/` (override with `REPRO_VERIFY_STATE`). It holds `state.json`, `serve.log`, the throwaway PEM, the blob root and browser profiles. There is one instance per checkout, so `up` refuses while one is recorded.

## Doctor

```sh
$RV doctor
```

This is read-only. Run it first, and again whenever anything looks off. All of these must be `ok`:

| check | what it proves |
| --- | --- |
| `process` | the recorded pid is alive and is `src/serve.ts` of this checkout |
| `events port`, `webhook port` | `lsof` says that pid holds both ports |
| `database target` | `DATABASE_URL` is `127.0.0.1:<our port>`, never a remote host |
| `container` | our container is running and carries our state-dir label |
| `schema` | the six core tables exist |
| `api` | `GET /api/me` is `200`, `mode: local`, `accounts: false` |
| `bundle built` | `web/out` is newer than every web source |
| `bundle served` | `GET /` is byte-identical to `web/out/index.html`, so the process is serving the current build |
| `browser port` | `127.0.0.1:9222` is free, which `browse` needs |

`bundle served` fails after a rebuild while the service is up: `src/static.ts` reads the bundle once at boot. Fix it with `$RV down && $RV up`.

## Drive

| lever | use |
| --- | --- |
| `$RV browse <steps…>` | a real headless Chrome on the dashboard, through the repo's own CDP client `src/browser.ts` |
| `$RV webhook <event> <file\|-> [--unsigned]` | sign a delivery with the instance's secret and POST it to the receiver; prints `status` and `body` |
| `$RV cli <args…>` | `src/cli.ts` against the instance's database |
| `$RV sql "<sql>"` | `psql -At` in our container, **read-only** (`default_transaction_read_only=on`); `--write` lifts it, for fixture cleanup only |
| `$RV logs [n]` | last n lines of the service log (default 40) |
| `$RV evidence` | the evidence directory, for `tee` |

`browse` steps run in order in one browser, which is started and killed per invocation:

| step | effect |
| --- | --- |
| `go PATH` | navigate to `PATH` on the dashboard and wait for load |
| `wait RE` | poll the page's `innerText` until the case-insensitive regex matches (15s) |
| `absent RE` | poll until it does NOT match (15s) |
| `click CSS` | `element.click()` on the first match |
| `fill CSS TEXT` | set an input or textarea value so React's `onChange` fires |
| `shot NAME` | viewport PNG to `<evidence>/NAME.png` (window 1280x1000, `REPRO_VERIFY_WINDOW=w,h` to change) |
| `text NAME` | page `innerText` to `<evidence>/NAME.txt` |
| `console NAME` | console, browser log and uncaught exceptions to `<evidence>/NAME.console.txt` |

Example (real):

```sh
$RV browse go /repos wait 'verify-org/widgets' wait 'not onboarded yet' shot listed \
  click 'a[href="/repos/verify-org/widgets"]' wait 'how should we run your project' text repository
```

Rules that keep a drive honest:

- Every `go` lands on the same shell document, and the view renders after `/api/me` and its own fetch return. Wait for **data** (a repository name, a run id), not for a heading or nav label, which render while still loading.
- `absent` passes on a page that has not loaded yet. Always put a `wait` for loaded-state text **before** an `absent`.
- `innerText` applies CSS `text-transform`, and headings, tabs, table heads and buttons render uppercase. Every pattern is already case-insensitive. Do not match on case.
- Content inside a closed `<details>` is absent from `innerText`. Click its `summary` first.
- Stable handles: route paths (`/repos`, `/repos/<owner>/<name>`, `/runs`, `/runs/<uuid>`, `/settings`), `a[href="…"]` links, `[role=tab]`, `#recipe`, `#secret-name`, `#secret-value`, `details.quiet > summary`, `.as-json > summary`, `nav[aria-label=Sections]`.

## Evidence

Evidence goes to `.verify-evidence/<run-id>/` in the checkout (gitignored). `up` creates it and prints it; `$RV evidence` prints it again. `down` copies `serve.log` into it and never deletes it.

Proof standards:

- Drive the real user path: a signed delivery for anything GitHub would send, the dashboard for anything a person clicks. `$RV cli seed` is an operator path and is acceptable only for preconditions a feature file names (a finished run cannot be produced locally without a model).
- Capture the action and the resulting state: the delivery's JSON response, then the screen. Capture more than the last screen.
- Verify the side effect beside what is visible: the row (`$RV sql`), the service log line (`$RV logs`), and the page.
- A negative control for every gate: an unsigned delivery is `401 bad signature` and writes nothing.
- A clean console (`"console": ["nothing logged"]`) is part of the proof for every page. A CSP violation or uncaught exception shows up there and nowhere else. The console accumulates across one `browse` invocation, so `console NAME` snapshots it at that step. A step that drives a refusal (a 400 or 404 page) adds a `Failed to load resource` line; snapshot before it or browse it separately.
- Name each artifact `<feature>-<step>-<what>` so a reader can match it to the feature file.

## Cleanup

```sh
$RV down
```

`down` stops the service pid only if its command line is this checkout's `src/serve.ts` (SIGTERM, then SIGKILL after 10s). It removes the container only if its label matches this state directory, deletes the state directory, and keeps the evidence. It prints the evidence path and the files kept. Run it after every failed iteration as well. It is safe with nothing running. Never kill by process name.

## Isolation

- One instance per checkout. Two checkouts (or worktrees) can run side by side: ports are free-picked and the container and state names are keyed by checkout path.
- `browse` cannot run twice at once on one machine. `src/browser.ts` hardcodes debug port 9222, so `browse` refuses while 9222 is taken (for example while `test/dashboard.browser.test.ts` runs). Do not kill whatever holds it.
- Never point `$RV` at the developer's `docker compose` Postgres. It shares a named volume with their dev data, and its password lives in `.env`.

## Feature map

`features/README.md` is the index and the maintained source of journeys. Read it, pick the feature that matches the change, and follow its recipe. A proof that drives one convenient entry point is incomplete when the feature lists others.
