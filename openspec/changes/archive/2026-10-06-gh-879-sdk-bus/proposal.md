## Why

[Hub #879](https://github.com/jimmie-potts/agent-device-hub/issues/879) is story A of the [#830](https://github.com/jimmie-potts/agent-device-hub/issues/830) split under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). ADR 0012 makes the SDK the one way B.U.N.N.Y. parts talk. Every later #830 story and every module needs its in-process bus first: publish, subscribe, request and respond with expiry, per-subscriber delivery and trace context.

## What Changes

- **New package `packages/sdk` (`@jimmie-potts/sdk`).** `InProcessBus` connects each participant by its CloudEvents source and gives it an `Sdk` with `publish`, `subscribe`, `request` and `respond`. The calls return promises and name no transport, so sync (#881), the module host (#880) and the SSE/HTTP transport (#883) keep them.
- **Routing keys.** Keys are `bunny.<state|event|cmd>.<family>.<id>`, and patterns use `*` for one token. State and removal messages use `bunny.state` keys, and occurrences and outcomes use `bunny.event` keys. Commands use `bunny.cmd` keys, through request and respond only.
- **Request and respond.** One responder owns each key. A command carries `expiresat` and a `requestId`. The result is accepted, rejected in the shared error body, or `uncertain-result` at the deadline, and nothing retries it. A responder ignores a command past its expiry.
- **Delivery.** Each subscription and responder has its own bounded queue, so a slow handler delays only itself. A full queue drops the message for that subscription and reports `capacity` through `onError`.
- **Trace context.** Every message carries W3C trace context. A message sent with a parent continues the parent's trace in a new span.
- **Plain objects.** The bus does not copy, serialize or validate messages. The tests check every message they see against profile 2.0.
- **Wiring.** The workspace joins `build` and `typecheck`, adds `test:sdk` and `test:sdk:built`, and the core CI job runs `test:sdk:built`.

## Capabilities

### New Capabilities
- `bunny-sdk`: the SDK's in-process bus, with publish and subscribe by routing key, request and respond with expiry, per-subscriber delivery and trace propagation.

### Modified Capabilities
None. The bus uses `bunny-message-profile` (`@jimmie-potts/event-contracts/v2`) unchanged.

## Impact

- **Source:** `packages/sdk/` (sources, tests and README), under the strict profile.
- **Shared files:**
  - the root `package.json` and `package-lock.json`, for the workspace and scripts;
  - `.github/workflows/checks.yml` and `tests/workflow_checks.cjs`, for one core-job step;
  - `docs/development.md`, for the SDK checks.
- **Nothing else:** nothing runs the bus yet. There is no runtime, Hub, controller, contract or device change. Delivery target: source-only.

**No design.md.** ADR 0012 is the design record for the SDK. It states the in-process bus and its calls, routing keys, command expiry, no replay, the slow-consumer rule, trace context and portability, with their trade-offs and rejected alternatives. This change adds a library with no runtime, storage, migration or privacy behavior.
