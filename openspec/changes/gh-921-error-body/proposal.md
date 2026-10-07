## Why

[ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) gives every boundary one error body and code registry. [Hub #921](https://github.com/jimmie-potts/agent-device-hub/issues/921) brings app-verify's command-line refusals and maintenance intake's blocked responses onto that body. Both are released 1.x contracts with outside consumers: Nanoleaf and Pixoo vendor app-verify, and the dotfiles nightly supervisor runs maintenance intake. Until the cutover they may change only additively, and the retirement story ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)) removes the old fields.

## What Changes

- An app-verify refusal line keeps its 1.x string `error` and `detail` and adds `errorBody`, the registry body `{"error": {"code", "retryable", "detail"}}`. This covers the operation refusal line and a `stop` that reports `receipt-locked` with its cleanup, which `restart` passes on. Failed outcomes, receipts (`app-verification/1`), exit codes and the lifecycle do not change.
- A maintenance intake `blocked` response keeps `schemaVersion`, `status`, `selections` and `reason` and adds `error`, the registry body. `complete` and `uncertain` responses, the intake authority and stdin do not change.
- `detail` keeps the 1.x reason in both tools, so the body still names it after #839.
- Each package README maps every refusal to its registry code. No new registry code is needed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-proof-handoff`: the core's refusal lines carry the shared error body beside their 1.x fields. This capability already owns making verification failures actionable and the wrapper's JSON result.
- `maintenance-intake`: the one authorized execution owner's refusals carry the shared error body in `blocked` responses.

## Impact

- **Code:** `packages/app-verify` (`src/error-body.ts`, the CLI and `stop`), `apps/maintenance` (`src/error-body.ts`, the CLI and intake), both packages' tests, `scripts/package-app-verify.mjs` and `scripts/package-maintenance.mjs`.
- **Docs:** both READMEs, `docs/app-verification.md` and `docs/development.md`.
- **Unchanged:** the app-verify public exports, both packages' dependencies, the lockfile and the intake bundle.
- **Out of scope until #839:** refusals that adapters and wrappers print themselves, maintenance's other entry points, and failed outcomes.
- **Delivery:** source-only. app-verify is development tooling, and the installed intake is replaced at the cutover ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)).
