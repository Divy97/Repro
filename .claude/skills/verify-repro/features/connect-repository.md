# Connect a repository

When someone installs the GitHub App on a repository, or adds one to an existing installation, GitHub sends a signed delivery. Repro records the repository and lists it on the dashboard under "Connected, not onboarded". Removing it from the installation takes it off the list. An unsigned or wrongly signed delivery changes nothing.

## Sub-features

- `connect-reject-unsigned`: a delivery without a valid `x-hub-signature-256` is refused with `401 bad signature` and writes nothing.
- `connect-add`: `installation_repositories` `added` (or `installation` `created`) records the repository as installed and not onboarded.
- `connect-list`: `/repos` shows it in the "Connected, not onboarded" register with account, "just now" and `✗ not onboarded yet`.
- `connect-open`: its link opens `/repos/<owner>/<name>`, which starts on the onboarding step "How should we run your project?".
- `connect-remove`: `installation_repositories` `removed` (or `installation` `deleted`) takes it off `/repos`.
- `connect-ignore`: events that are not triggers (`push`, `installation` `suspend`) are `202 not a trigger` and change nothing.

## How to get to it (user POV)

- Install the App from the "Install on GitHub" button on an empty `/repos`. On a deployment with `GITHUB_APP_SLUG` set it links to `https://github.com/apps/<slug>/installations/new`, and GitHub then sends the delivery. **On this local instance it does not:** `up` sets no `GITHUB_APP_SLUG`, so `src/routes.ts` points the button at `https://github.com/settings/apps/new` (register a new App), not an install flow. Do not click it as part of a proof; the signed delivery below is the install.
- Add or remove repositories in the installation's settings on GitHub, which sends `installation_repositories`.
- Uninstall the App on GitHub, which sends `installation` `deleted`.

## Driving it with repro-verify

Preconditions:

- Baseline instance (`$RV doctor` all ok). `$RV sql "select count(*) from installations"` prints `0`.
- `E=$($RV evidence)`.
- The two payloads, written to the evidence directory:

```sh
cat > "$E/connect-added.json" <<'JSON'
{"action":"added","installation":{"id":4242,"account":{"login":"verify-org"}},"repositories_added":[{"full_name":"verify-org/widgets"}],"repositories_removed":[]}
JSON
cat > "$E/connect-removed.json" <<'JSON'
{"action":"removed","installation":{"id":4242,"account":{"login":"verify-org"}},"repositories_added":[],"repositories_removed":[{"full_name":"verify-org/widgets"}]}
JSON
```

- **Empty state.** Open the repository list. Run `$RV browse go /repos wait 'no repositories are connected yet' shot connect-0-empty`. The page shows "No repositories are connected yet." and an "Install on GitHub" button.
- **Reject unsigned.** Send the install without a signature. Run `$RV webhook installation_repositories "$E/connect-added.json" --unsigned | tee "$E/connect-1-unsigned.json"`. Output has `"status": 401, "body": "bad signature"`, and `$RV sql "select count(*) from installations"` is still `0`.
- **Install.** Send it signed. Run `$RV webhook installation_repositories "$E/connect-added.json" | tee "$E/connect-2-added.json"`. Output has `"status": 202, "body": "accepted"`. `$RV logs 2` ends with `installation 4242: added verify-org/widgets` and `verify-org/widgets: installed — not onboarded yet, no recipe approved`. `$RV sql "select repo, installation_id, account, removed_at is null from installations" | tee "$E/connect-2-installations.txt"` prints `verify-org/widgets|4242|verify-org|t`.
- **Listed.** Reload the list. Run `$RV browse go /repos wait 'verify-org/widgets' wait 'connected, not onboarded' wait 'not onboarded yet' shot connect-3-listed text connect-3-listed`. The register reads `1 connected, each waiting for a recipe` with the row `verify-org/widgets  verify-org  just now  —  ✗ not onboarded yet`, and the hero line reads "Nothing here can run yet". Console: `nothing logged`.
- **Open it.** Follow the row's link. Run `$RV browse go /repos wait 'verify-org/widgets' click 'a[href="/repos/verify-org/widgets"]' wait 'how should we run your project' text connect-4-repository shot connect-4-repository console connect-4`. The page heading is `verify-org/widgets` with "✗ not onboarded yet", and the checklist marks "Work out how to run your project — do this next".
- **Remove.** Send the removal signed. Run `$RV webhook installation_repositories "$E/connect-removed.json" | tee "$E/connect-5-removed.json"`. Output has `202 accepted`. `$RV logs 2` ends with `installation 4242: removed verify-org/widgets` and `verify-org/widgets: removed`. `$RV sql "select repo, removed_at is not null from installations"` prints `verify-org/widgets|t`.
- **Gone.** Run `$RV browse go /repos wait 'no repositories are connected yet' absent 'verify-org/widgets' shot connect-6-removed text connect-6-removed console connect-6`. The empty state is back and the repository is not on the page.
- **Proof.** The evidence directory holds both payloads, the four webhook responses, the two `installations` reads, the screenshots and texts `connect-0` to `connect-6`, and the console files, all reading `nothing logged`.

## Gotchas

- **Verified on 2026-10-24:** every step above, as the skill's end-to-end proof. `connect-ignore` was verified with a `push` event in `issue-intake.md`; `installation` `created`/`deleted` were not sent.
- The receiver accepts any path on the webhook port. `$RV webhook` posts to `/`. The hosted plane's equivalent is `POST /webhook` on its single port, which this surface does not have.
- The signature is over the exact bytes sent. Editing the payload file after signing is not possible with `$RV webhook` (it signs what it sends), but a hand-rolled `curl` that re-serialises JSON will 401.
- Removal is a soft delete (`removed_at`). The row stays and a re-add revives it. Assert `removed_at`, not row count.
- A re-add after removal lists the repository again (observed). Removal leaves `recipes` alone (`src/serve.ts`), so a repository approved before removal comes back already onboarded.
- `installation` `created` with an empty `repositories` list (the "all repositories" grant) is logged as `naming no repository — nothing to record` and records nothing. The local surface does not reconcile against GitHub; the plane does.
- `wait 'repositories'` matches the nav label on the loading shell. Wait for the repository name or the empty-state sentence instead.
