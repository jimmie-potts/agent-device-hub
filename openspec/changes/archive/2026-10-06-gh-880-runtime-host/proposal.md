## Why

[Hub #880](https://github.com/jimmie-potts/agent-device-hub/issues/880) is story B of the [#830](https://github.com/jimmie-potts/agent-device-hub/issues/830) split under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). ADR 0012 puts the core and every device into one TypeScript runtime process, `apps/runtime`, whose modules come from a fixed, shipped list and talk through the SDK's in-process bus (#879). The rebuild needs that process and its module host before any module can join: a runtime that starts with zero modules and serves health, manifests with an API version check, a module context, and failure isolation in which a module's errors stop only that module while a stuck process restarts as a whole. The #879 reviews also found SDK gaps that the host needs, which #880's scope comment adds to this story.

## What Changes

- **SDK: participant close.** `connect` returns a participant whose `close` closes everything it opened. Its pending requests settle first: `cancelled` when the command is still queued, which leaves the queue, and `uncertain` once a handler has it. Their deadlines are cleared, its subscriptions and responders close, and later calls are refused with `invalid-state`. It never waits for another participant's handler.
- **SDK: deadlines on an injected scheduler.** `BusOptions.scheduler` runs request deadlines; the default stays the global `setTimeout`.
- **SDK: `expired` for a command that never ran.** A command still queued at its deadline leaves the responder's queue, and its request is rejected as `expired` instead of `uncertain-result`. A command that reaches the responder at or after its expiry is answered the same way at once. A command its handler has keeps `uncertain-result`.
- **SDK: leftover #879 findings.** The README, spec and the `close()` doc comment say that close detection follows the handler's async flow and that two handlers awaiting each other's close deadlock. New tests pin the queue's identity and `done` guards and the `maxQueued` `RangeError`. The archived #879 proposal now says that a full subscription queue reports `capacity` to `onError` while a full responder queue gives the requester `capacity`.
- **SDK: module API.** `BunnyModule`, `ModuleManifest`, `ModuleContext`, `Logger`, `Tracing`, `ModuleScheduler`, `Workers`, `MODULE_API_VERSION` (`1.0`), `childOf` and `traceFields`. A module imports only the SDK and the contracts packages, so these live in the SDK.
- **New app `apps/runtime` (`@jimmie-potts/runtime`).** The runtime serves `GET /api/runtime/v1/health` on loopback and starts with an empty shipped module list. It refuses a module whose manifest or API version does not match, and gives each started module a context with its own participant, a logger, tracing, the runtime's clock and scheduler, worker threads, its own `node:sqlite` file and an abort signal. Its state directory is private and outside every Git checkout.
- **Failure isolation.** A module's thrown error, rejected promise or device timeout stops only that module through its participant's close, and health shows it `failed`. Errors that escape to the process are attributed to the module whose async flow raised them. Any other escaped error exits 1.
- **Event-loop lag check.** A watchdog thread kills a process whose event loop stays stuck past the lag limit, and systemd's `Restart=on-failure` restarts the runtime.
- **Wiring.** The workspace joins `build` and `typecheck`, adds `test:runtime` and `test:runtime:built`, and the core CI job runs `test:runtime:built`.
- **Sync (#881) fold-in, from the review round.** Participant close also closes the participant's sync copies and sync owners, and a closed copy withdraws its outstanding request. A sync request still queued at its deadline leaves the owner's queue and stays `unavailable`. Sync deadlines run on the injected scheduler, `onSyncRestart` reports each overflow restart, and health counts them per module. One sentence of "Sync a consumer's copy from its owner" is reordered.
- **ADR 0012 amendment.** "High-impact messages" says that a command still queued at its deadline is answered `expired`, and that only an unknown fate is uncertain.

## Capabilities

### New Capabilities
- `bunny-runtime`: the runtime process and module host, with health, manifests and the API version check, the module context, failure isolation, private state and the event-loop lag check.

### Modified Capabilities
- `bunny-sdk`: participant close, including sync copies and owners; request and sync deadlines on an injected clock and scheduler; `expired` for a command that never reached its handler; a sync request still queued at its deadline leaving the owner's queue; `onSyncRestart`; and the close-from-a-handler rules for other subscriptions and left-behind continuations.

## Impact

- **Source:** `apps/runtime/` (new, with its README) and `packages/sdk/` (sources, tests and README), both under the strict profile, which already covers `apps/runtime/**`.
- **Shared files:**
  - the root `package.json` and `package-lock.json`, for the workspace and scripts;
  - `.github/workflows/checks.yml` and `tests/workflow_checks.cjs`, for one core-job step;
  - `docs/development.md`, for "Runtime checks";
  - `docs/architecture.md`, which notes that the runtime skeleton exists as source;
  - `docs/decisions/0012-bunny-event-platform.md`, for the `expired` amendment;
  - `openspec/changes/archive/2026-10-06-gh-879-sdk-bus/proposal.md`, for the capacity wording.
- **Behavior change for SDK callers:** a request whose command was still queued at its deadline now resolves as `rejected` with `expired`, not `uncertain` with `uncertain-result`. Nothing outside the SDK's tests uses the SDK yet.
- **Nothing else:** no Hub, controller, contract, installation or device change. The runtime binds only the port it is given; tests use port 0. Delivery target: source-only. The zero-module memory baseline is measured for [#123](https://github.com/jimmie-potts/agent-device-hub/issues/123).
- **Deferred:** the module test kit and fixture module (#882), sync (#881) and installing the runtime (#840).
