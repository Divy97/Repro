# Onboard a repository

A connected repository cannot take work until a person approves the commands that install, start and test it (ADR-0013: the approval is the control). On `/repos/<owner>/<name>` the Environment step offers to have an agent propose the commands, or lets the person write them as JSON, refuses anything that does not parse or validate, and stores what is approved. After approval the local service starts a proving run in the background.

## Sub-features

- `onboard-propose`: the step "How should we run your project?" with "Work it out for me" (agent drafting) and "Or write them yourself".
- `onboard-reject-unparsable`: text that is not JSON is refused in the page ("That is not valid JSON: …") and nothing is sent.
- `onboard-reject-invalid`: JSON that is not a valid recipe is refused by the server with `400` and the reason, and nothing is stored.
- `onboard-approve`: a valid recipe is stored ("Stored. Every run against this repository will now execute these commands.") and the repository shows "recipe approved".
- `onboard-prove`: after approval the service clones and proves the repository in the background (needs GitHub).
- `onboard-review`: a drafted proposal is reviewed as an ordered list ("What will run, in order") with risky commands flagged before "Use these commands".

## How to get to it (user POV)

- From `/repos`, choose a repository in "Connected, not onboarded". It opens on the Environment step.
- On `/repos/<owner>/<name>`, choose the `Environment` tab (`[role=tab]:nth-of-type(2)`), or the checklist's "do this next" call.
- Terminal: `$RV cli recipe show <owner/repo>` reads what is stored. `recipe approve <draft.json> <owner/repo>` needs a TTY to answer its prompt.

## Driving it with repro-verify

Preconditions:

- Baseline instance, then `verify-org/widgets` connected with the **Install** step of `connect-repository.md`.
- `$RV sql "select count(*) from recipes"` prints `0`.

- **Propose step.** Open the repository. Run `$RV browse go /repos/verify-org/widgets wait 'how should we run your project' text onboard-0-propose`. The step shows "Work it out for me" and "Or write them yourself", and the checklist marks "Work out how to run your project — do this next".
- **Open the editor.** Expand the manual path. Run `$RV browse go /repos/verify-org/widgets wait 'how should we run your project' click 'details.quiet > summary' wait 'use these commands' click '.as-json > summary' wait 'the commands, as json' shot onboard-1-editor`. A textarea `#recipe` labelled "The commands, as JSON" holds the empty skeleton, with the ADR-0013 warning ("you are the control") above the button.
- **Reject unparsable.** Run `$RV browse go /repos/verify-org/widgets wait 'how should we run your project' click 'details.quiet > summary' fill '#recipe' 'this is not json' wait 'the commands, as json' click 'details.quiet button.primary' wait 'that is not valid json' text onboard-2-unparsable`. The JSON editor opens by itself (it opens when the text does not parse) and the page says "That is not valid JSON: …". `$RV logs 3` shows no new line and `recipes` is still `0`.
- **Reject invalid.** Run `$RV browse go /repos/verify-org/widgets wait 'how should we run your project' click 'details.quiet > summary' fill '#recipe' '{"services":[{"name":"Bad Name","command":"npm start","port":3000}]}' click 'details.quiet button.primary' wait 'lowercase name usable as a session id' text onboard-3-invalid`. The server's `400` reason is shown, and `recipes` is still `0`.
- **Approve.** This step leaves the machine: approval starts `onboard-prove`, which asks `api.github.com` for an installation token as the fake App and is refused with 401. Skip it where outbound calls are not allowed, and report `onboard-approve` as unverified. Run `$RV browse go /repos/verify-org/widgets wait 'how should we run your project' click 'details.quiet > summary' fill '#recipe' '{"install":"npm ci","test":"npm test"}' click 'details.quiet button.primary' wait 'stored. every run against this repository' text onboard-4-approved shot onboard-4-approved`. Then `$RV sql "select repo, recipe from recipes"` prints the row, `$RV cli recipe show verify-org/widgets` prints the JSON, and `/repos` lists the repository under "Onboarded" with "✓ recipe approved".
- **Prove (unverifiable here).** `$RV logs 5` should end with a line starting `verify-org/widgets: could not be proved —`, because the token mint is refused. A real proof needs a real App and the sandbox images.
- **Proof.** Texts and screenshots `onboard-0` to `onboard-4`, the `recipes` reads before and after, and the log lines.

## Gotchas

- **Verified on 2026-10-24:** propose, open the editor, reject unparsable, reject invalid. **Not run:** approve and prove (they leave the machine) and `onboard-review` (needs a draft). Those steps are written from `web/components/views/Environment.tsx` and `src/routes.ts`.
- The reject-invalid step's console carries `[error] Failed to load resource: the server responded with a status of 400 (Bad Request)`. That is the refusal itself, not a page fault. Every other step's console must read `nothing logged`.
- **Product bug in local mode, observed:** the checklist says "A model key is configured — done. This deployment uses the operator's key." while the step below it says the key "has not stored" and "Work it out for me" is disabled. `/api/me` answers `modelKey: null` when there are no accounts, and the button is `disabled={me?.modelKey === null}`. Drafting cannot be started from the local dashboard at all. Even if it could, it clones from GitHub first (unverifiable here).
- `#recipe` is a React-controlled textarea. Type into it with `fill` only. A drive that assigns `.value` directly leaves React's state unchanged, and approve then sends the old text.
- The editor sits inside two disclosures: `details.quiet` ("Or write them yourself") and `.as-json` ("Edit as JSON"). Text inside a closed one is absent from `innerText`.
- `details.quiet button.primary` is "Use these commands" on the propose step. "Work it out for me" is also `button.primary`, outside `details.quiet`.
- `onboard-review` needs a stored draft, which only the drafting agent writes (`recipe_drafts`). Seeding one with `$RV sql --write` is a fixture, not a user path, so report the review as driven from a fixture if you do it.
- Approval is stored even when proving fails. A green "Stored" is not evidence that the repository builds.
