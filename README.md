# Repro

**Open a GitHub issue. Get back a pull request that proves the bug was there before the change — and gone after it.**

Live: **https://test-framework.fly.dev**

## What it does

Repro is not a coding agent. It is the verification system *around* one. An AI agent writes the fix; Repro decides whether to believe it, by executing code rather than by reading the agent's explanation.

1. **Reproduce first.** A failing test has to go red on the original commit, showing the symptom the reporter described.
2. **Then fix.** The agent works in a sandbox with no network and no credentials in it.
3. **Then prove it.** The same test runs green on the fix, and the project's own suite runs on *both* commits — so a fix that repairs one bug and breaks forty other tests is reported as a finding, not shipped as a success.
4. **No reproduction, no fix.** If step 1 fails, no patch is attempted. You get a question about the one missing detail instead.

Every claim in the pull request is an exit code the engine ran itself, in a container the agent could not reach. The agent's transcript is shown, never trusted.

## Confidence tiers

| Tier | Meaning |
| --- | --- |
| **1** | Reproduced by a test whose independence is established |
| **2** | Reproduced, independence unverified — an agent-authored reproduction lands here |
| **3** | Not reproduced — **no fix attempted** |

## Under the hood

A run is an append-only event log in Postgres. There is no runs table: state is a fold over events, every screen is a rebuildable projection, and `npm run rebuild` drops the read model and replays the log into byte-identical rows.

A control plane holds the address GitHub can always reach; a runner dials out from hardware you own and executes the work. The plane never spends a model key; the sandbox never holds one.

## Status

The engine works and has opened real pull requests — [this one](https://github.com/Divy97/test-framework-v2-demo/pull/4) came from a real issue via a real webhook: Tier 2, 95 seconds, $0.06. The product around it is still being built.

## Docs

- [Architecture](docs/architecture-v1.5.md)
- [Decision records](docs/adr/)
- [The long version of this page](docs/deep-dive.md) — the full design, and an honest list of what is still not true
