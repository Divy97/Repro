# Issue intake

Opening or labelling an issue on a repository makes GitHub send a signed `issues` delivery. Repro acknowledges it at once with `202`, then decides on its queue of one. An uninstalled repository is ignored. An installed one with no approved recipe gets a comment saying it is not onboarded and that no run was started. An onboarded one starts a run. Everything else GitHub sends is acknowledged as "not a trigger".

## Sub-features

- `intake-reject-unsigned`: an unsigned `issues` delivery is `401 bad signature`.
- `intake-not-trigger`: any other event (`push`, `issue_comment`) or action (`closed`, `edited`) is `202 not a trigger` and is not queued.
- `intake-uninstalled`: `opened` on a repository that is not installed is queued, then logged `not installed — ignoring`, with no run and no job.
- `intake-not-onboarded`: `opened` on an installed repository with no recipe comments on the issue and starts nothing (needs GitHub).
- `intake-run`: `opened` on an onboarded repository starts a run, which mints a token, clones and drives the agent (needs GitHub and a model).

## How to get to it (user POV)

- Open an issue, or add a label to one, on a repository where the App is installed. GitHub sends `issues` with `action` `opened` or `labeled`.

## Driving it with repro-verify

Preconditions:

- Baseline instance. `E=$($RV evidence)`.
- The payload, written to the evidence directory:

```sh
cat > "$E/intake-opened.json" <<'JSON'
{"action":"opened","issue":{"number":7,"title":"Totals are wrong","body":"Applying a code twice charges full price.","html_url":"https://github.com/verify-org/ghost/issues/7"},"repository":{"full_name":"verify-org/ghost"},"installation":{"id":4242}}
JSON
```

- **Reject unsigned.** Run `$RV webhook issues "$E/intake-opened.json" --unsigned | tee "$E/intake-0-unsigned.json"`. `"status": 401, "body": "bad signature"`, and `$RV logs 1` shows no `queued` line.
- **Not a trigger.** Send the same bytes as another event. Run `$RV webhook push "$E/intake-opened.json" | tee "$E/intake-1-push.json"`. `"status": 202, "body": "not a trigger"`, and nothing is logged.
- **Uninstalled.** Run `$RV webhook issues "$E/intake-opened.json" | tee "$E/intake-2-uninstalled.json"`. `202 accepted`. `$RV logs 2 | tee "$E/intake-2-log.txt"` shows `verify-org/ghost#7: queued` then `verify-org/ghost#7: not installed — ignoring`. `$RV sql "select count(*) from events"` is `0`: no run wrote a single event.
- **Not onboarded (unverifiable here).** Connect `verify-org/ghost` with the **Install** step of `connect-repository.md` (change the `full_name` to `verify-org/ghost`), then resend the signed delivery. The service tries to comment on the issue as the fake App. Expect `verify-org/ghost#7: not onboarded — commenting, and starting no run`, then `verify-org/ghost#7: could not comment — …`, because the token mint is refused with 401. This leaves the machine for `api.github.com`.
- **Onboarded run (unverifiable here).** With a recipe approved, the run fails at the token mint, `verify-org/ghost#7: could not start — …`. A real run needs a real App and model key. The local substitute is `test/run.test.ts` (see `README.md`, Surfaces not mapped).
- **Proof.** The three webhook responses, the log excerpt, and the zero `events` count.

## Gotchas

- **Verified on 2026-10-24:** unsigned (`401`), `push` (`202 not a trigger`), and uninstalled (`queued` then `not installed — ignoring`, no events written). **Not run:** the not-onboarded and onboarded paths, which leave the machine for `api.github.com`, and `labeled`.
- `202 accepted` only says the delivery parsed. The decision happens after the response, on the queue, so assert on `$RV logs`, never on the status alone.
- The local surface runs the run inline on its queue and writes no `jobs` row. `jobs` belongs to the plane and runner path, so count `events`, not `jobs`, to show that no run started.
- `labeled` is a trigger as well as `opened`. Send `"action":"labeled"` to cover that entry point; it takes the same path.
