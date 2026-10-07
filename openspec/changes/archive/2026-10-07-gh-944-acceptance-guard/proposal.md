## Why

[docs/sdlc.md](../../../docs/sdlc.md#acceptance-review) allows one Acceptance run at a time on a host, because memory is the limit, and only procedure enforces it. The Acceptance review of PR #942 started a second clean run beside an active one and nothing refused it. [Hub #944](https://github.com/jimmie-potts/agent-device-hub/issues/944) adds the refusal. app-verify is a released 1.x contract that Nanoleaf and Pixoo vendor, so the change is additive: the guard is opt-in, and receipts, leases, cleanup and the exit codes of existing paths do not change.

## What Changes

- A `start` that opts in with `APP_VERIFY_SINGLE_RUN=1` is refused with `run-active` while any run's service unit is live on the host or another guarded start holds the host's start claim, so two starts begun together cannot both pass. The refusal keeps the 1.x `error` and `detail`, carries `errorBody` with the registry's `capacity` code, exits 1 and comes before anything is created.
- The Hub's `verify`, `verify:compose`, `verify:chompi` and `verify:runtime` scripts and the host route opt in. The test suites do not, so they keep starting runs side by side.
- The composition counts as one run: it checks once and starts its own three runs without the variable.
- Two confusing refusal messages say what differs: an unknown scenario ("no scenario named X; help lists the scenarios") and a run that is not running (its state, or the unit that is not active or not the recorded process).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-proof-handoff`: the core's `start` can refuse a second live run, and its refusals name what differs. This capability already owns the core's refusal lines and the wrapper's JSON result.

## Impact

- **Code:** `packages/app-verify` (a unit listing and the start claim in `systemd.ts`, `single-run.ts`, `start`, the CLI, the two messages, additive exports), `apps/hub/verify/compose.mjs`, `scripts/verify-host.mjs` and the four wrapper scripts in `package.json`.
- **Docs:** the core README, `docs/app-verification.md`, `docs/sdlc.md` and `docs/development.md`.
- **Unchanged:** receipts (`app-verification/1`), leases, cleanup, the exit codes of existing paths, the core's dependencies and the lockfile. The CHOMPI wrapper opts in through its package script; no CHOMPI file changes.
- **Delivery:** source-only. app-verify is development tooling.
