# Read a run's evidence

Every run is an append-only event log, and every screen about it is a projection of that log. `/runs` lists runs newest first with status, tier and confidence. `/runs/<uuid>` is the evidence page: the verdict from the fold (tier, confidence, grounds), the reproduction and regression arms with exit codes, the timeline of events, the agent's messages labelled as testimony, and what the run cost.

## Sub-features

- `runs-register`: `/runs` shows one row per projected run, linking to it.
- `run-verdict`: the evidence page heads with status, `Tier N`, `confidence X/Y` and the suite caveat.
- `run-arms`: "The reproduction arm" and "The regression arm" with exit codes on base and fix.
- `run-timeline`: "What happened" lists each event in order ("The run was requested", "A sandbox was created", …), read from the log for a finished run.
- `run-testimony`: the agent's messages by hash, "stored, and an input to no verdict".
- `run-missing`: an unknown or malformed run id shows "No such run".

## How to get to it (user POV)

- Choose `Runs` in the top navigation (`nav[aria-label=Sections] a[href="/runs"]`), then a run id in the register.
- From a repository's `Start a run` tab, which lists that repository's runs.
- Open `/runs/<uuid>` directly (the URL a pull request links to).

## Driving it with repro-verify

Preconditions:

- Baseline instance with no runs.
- A finished run in the log. No run can be produced locally without a model and GitHub, so seed the demo log through the operator CLI and project it: `$RV cli seed` prints `seeded 8 events for run 3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7`, then `$RV cli rebuild` projects it into `run_projection`.
- `$RV sql "select run_id, status from run_projection"` prints `3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7|pr_opened`.

- **Register.** Open the run list. Run `$RV browse go /runs wait '3f1c9a52' text runs-0-register shot runs-0-register`. The caption reads "1 run, newest first", and the row reads `3f1c9a52  (unknown)  #0  2026-08-05  pr opened  1 …  70/103`.
- **Open the run.** Follow the id. Run `$RV browse go /runs wait '3f1c9a52' click 'a[href="/runs/3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7"]' wait 'the reproduction arm' wait 'the run was requested' wait 'tier 1' text runs-1-evidence shot runs-1-evidence console runs-1`. The page shows `status PR OPENED`, `Tier 1 reproduced by a failing test whose independence is established`, `confidence 70/103`, both arms, and the timeline from "The run was requested" onward. Console: `nothing logged`.
- **Verdict agrees with the fold.** Run `$RV cli replay 3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7 | tee "$E/runs-2-replay.txt"`. It ends `tier 1, confidence 70/103`, the same numbers the page shows.
- **Unknown run.** Run `$RV browse go /runs/00000000-0000-4000-8000-000000000000 wait 'no such run' text runs-3-missing`. The page reads "No such run".
- **Proof.** The register and evidence texts and screenshots, the replay output, and the missing-run text.

## Gotchas

- **Verified on 2026-10-24:** every step. The register, the click-through and the evidence page had a clean console, the replay ended `tier 1, confidence 70/103`, and the unknown run read "No such run".
- The unknown-run page logs two `[error] Failed to load resource: … 404 (Not Found)` lines: its own `/evidence` and `/events` reads. The console is cumulative for one `browse` invocation, so take `console runs-1` before navigating to the missing run, or browse it in a separate invocation.
- The demo log's `thread_ref` is a Slack thread, so the repository reads `(unknown)` and the issue `#0`. That is true of that log and is not a rendering bug.
- `$RV cli seed` without `rebuild` leaves the run out of `/runs`. The register reads `run_projection`, which only `rebuild` (or a real run's `projectOne`) writes.
- `seed` is not idempotent: a second `seed` fails with `duplicate key value violates unique constraint "events_run_id_seq_key"`. Start from a fresh instance to reseed.
- **Product bug, observed:** `$RV cli rebuild` prints `dropped the projection and replayed [object Object] run(s) out of the log`. `rebuildProjection` returns `{ rebuilt, skipped }`, and `src/cli.ts` interpolates the object.
- The evidence page makes two requests: `/evidence` for the verdict and `/events` for the timeline. Wait for a timeline line ("the run was requested") as well as the arm heading, or the timeline assertions race.
- The first line of `innerText` is the live-region announcement (`Run. /runs/<uuid>`), not page content.
