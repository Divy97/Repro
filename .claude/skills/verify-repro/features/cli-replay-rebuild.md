# Replay and rebuild from the log

The operator's terminal surface over the event store. `replay <run_id>` reads one run's events and folds them in front of you, event by event, ending in the final state and the confidence score with its grounds and what was not measured. Nothing executes. `rebuild` drops the read model (`run_projection`) and replays every run's log back into it, which is the "the dashboard is disposable" property as a command.

## Sub-features

- `cli-replay`: prints `replay of run <id> — N events, pure fold, nothing executes`, one line per event with the running status, the final `RunState` as JSON, and `tier T, confidence S/C` with each ground's evidence hashes.
- `cli-replay-missing`: an id with no events prints `no events for run <id>` on stderr and exits `1`.
- `cli-rebuild`: empties `run_projection`, recomputes every row from `events`, and leaves `events` untouched.
- `cli-recipe-show`: `recipe show <owner/repo>` prints the stored recipe or `no recipe for <owner/repo>`.

## How to get to it (user POV)

- `npm run replay -- <run_id>` and `npm run rebuild` in the developer's checkout. Both load `.env`, which is production here, so **never** run them for verification. `$RV cli replay <run_id>` and `$RV cli rebuild` run the same `src/cli.ts` against the verification database.

## Driving it with repro-verify

Preconditions:

- Baseline instance. `E=$($RV evidence)`.
- The demo log seeded: `$RV cli seed` prints `seeded 8 events for run 3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7`.

- **Replay.** Run `$RV cli replay 3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7 > "$E/cli-0-replay.txt" 2>&1; echo "exit $?" >> "$E/cli-0-replay.txt"`. It begins `replay of run 3f1c9a52-… — 8 events, pure fold, nothing executes`, ends with `tier 1, confidence 70/103`, the grounds (`+45  the reproduction ran red on the base commit 1 time(s)…`), a `not measured:` list, and `exit 0`.
- **Missing run.** Run `$RV cli replay 00000000-0000-4000-8000-000000000000; echo "exit $?"`. It prints `no events for run 00000000-0000-4000-8000-000000000000` and `exit 1`.
- **Rebuild.** Snapshot, rebuild and compare. Run `$RV sql "select count(*) from events" > "$E/cli-1-events-before.txt"`, then `$RV cli rebuild | tee "$E/cli-1-rebuild.txt"`, then `$RV sql "select count(*) from events" > "$E/cli-1-events-after.txt"` and `$RV sql "select run_id, status, tier from run_projection" | tee "$E/cli-1-projection.txt"`. The event counts match (`8` and `8`), and the projection holds one row for `3f1c9a52-7b0e-4d2f-9c41-8a6e5d0b21c7`.
- **Rebuild is idempotent.** Run `$RV cli rebuild` again and re-read `run_projection`. The rows are identical.
- **Recipe show.** Run `$RV cli recipe show verify-org/widgets`. It prints `no recipe for verify-org/widgets` on a baseline instance.
- **Proof.** The replay transcript with its exit code, the before and after event counts, the rebuild output and the projection rows.

## Gotchas

- **Verified on 2026-10-24:** every step. The replay ended `tier 1, confidence 70/103`, the missing run exited `1`, the event count was `8` before and after rebuild, two rebuilds gave the same row (`3f1c9a52-…|pr_opened|1`), and recipe show printed `no recipe for verify-org/widgets`.
- `$RV cli … 2>/dev/null` also hides the CLI's own refusals (`no events for run …` goes to stderr). Keep stderr when the message is the proof.
- **Product bug, observed:** `rebuild` prints `replayed [object Object] run(s)`. `rebuildProjection` returns `{ rebuilt, skipped }` and `src/cli.ts` interpolates the object, so the count it promises is never printed. Assert on `run_projection`, not on that line.
- `cli.ts` itself does not read `.env`; the npm scripts add `--env-file=.env`. `$RV cli` gives it the verification `DATABASE_URL` and nothing else.
- `recipe approve` asks for a literal `yes` on a TTY and refuses (exit 1) without one, and `$RV` runs from a non-interactive shell. Drive approval through the dashboard (`onboard-repository.md`).
- `schema --yes` is what `up` runs. Running it again is harmless (every statement is `if not exists`), but it is a write and proves nothing about a feature.
