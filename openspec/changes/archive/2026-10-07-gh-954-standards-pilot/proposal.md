## Why

[Hub #954](https://github.com/jimmie-potts/agent-device-hub/issues/954) is Plan B's pilot slice under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827): it traces the first converted module ([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844), Nanoleaf, PR #968) and the first boundary change ([#948](https://github.com/jimmie-potts/agent-device-hub/issues/948), PR #956) from planning text to tests, kit checks, lint and reviews, and fixes the friction before more modules adopt the same tools. Four pieces of friction change specified behavior:
- A module answered a sync of one family with every family it serves. The bus refused that answer as `internal` and the host failed the module, so a read-only grant could stop it, and the module test kit, which synced all families together, did not see it (PR #968's Acceptance review).
- The runtime adapter's `doctor` reported `health: passed` while the runtime was `degraded` with a failed module, because its probe read only the HTTP status (#844's hand-off).
- The verification harness quoted an exception's message in its refusal body, its 500 answer and its lamp failures, and built its error body by hand ([#953](https://github.com/jimmie-potts/agent-device-hub/issues/953)'s hand-off). The run adapter quoted exceptions into a capture's proof.
- A one-run guard release that could not read which claim it took stopped the claim by name, which could stop another start's claim (PR #958's review).

## What Changes

- **Module test kit.** A module that serves more than one family gets a check that syncs each family alone, by owner, and fails a module that answers outside the request. Every module suite gets it with no change to its description.
- **A run's health.** The runtime adapter's readiness probe, which `start` waits for and `doctor` reports, judges the runtime's health document as the in-memory harness judges a scenario's start: every module runs, apart from a refusal the run's seed expects, and the lag check has not stopped. Its reason names modules, states and registry codes only.
- **Safe errors in the harness.** The supervisor's refusals come from `errorBody`: a malformed or `null` body is `invalid-request`, an oversized one `too-large`, and any other failure `internal` with fixed text; a lamp failure carries no message; the start-failure line names a cause code. The run adapter and a failed scenario step name a failure by their own text, a refusal's code or the exception's type. The `verification-harness` lint exception is removed; the runtime's usage error stays a stated permanent exception.
- **The one-run guard's release** stops nothing when it cannot tell its claim from another start's; the claim ends with its holder.
- **Outside the specs:** lint checks for four listed misses with stated reasons for the rest, a rule-to-check table in `docs/development.md`, the packaging scripts' scratch root, documentation fixes for the one-run guard and the shipped run's harness limits, and the boundary prompt in the bug and epic issue templates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: the module test kit syncs each served family alone.
- `bunny-runtime`: a disposable run's readiness and `doctor` judge the runtime's health; the harness's refusals and the run adapter's failure reports follow ADR 0012's safe errors; the shipped run's harness limits.
- `verification-proof-handoff`: a release that cannot tell its own claim stops nothing.

## Impact

- **Code:** `packages/sdk/src/testing/kit.ts`; `apps/runtime/verify` (new `health.ts`; `plugin.ts`, `seed.ts`, `supervisor.ts`, `child.ts`, `protocol.ts`, `adapter.ts`); `packages/app-verify/src/systemd.ts`; `scripts/eslint/bunny-rules.mjs`, `eslint.config.mjs`; `scripts/scratch-root.mjs` and the two packaging scripts; tests beside each.
- **Unchanged:** the runtime, its modules, the SDK's transports, the installed system, receipts, the app-verify contract's operations and exit codes, and every module's description of itself to the kit.
- **Delivery:** source-only.
