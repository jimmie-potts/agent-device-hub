## Why

[Hub #879](https://github.com/jimmie-potts/agent-device-hub/issues/879) is story A of the [#830](https://github.com/jimmie-potts/agent-device-hub/issues/830) split under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). ADR 0012 makes the SDK the one way B.U.N.N.Y. parts talk. Every later #830 story and every module needs its in-process bus first: publish, subscribe, request and respond with expiry, per-subscriber delivery and trace context.

## What Changes

- **New package `packages/sdk` (`@jimmie-potts/sdk`).** `InProcessBus` connects each participant by its CloudEvents source and gives it an `Sdk` with `publish`, `subscribe`, `request` and `respond`. The calls return promises and name no transport, so sync (#881), the module host (#880) and the SSE/HTTP transport (#883) keep them.
- **Routing keys.** Keys are `bunny.<state|event|cmd>.<family>.<id>`, and patterns use `*` for one token. State and removal messages use `bunny.state` keys, and occurrences and outcomes use `bunny.event` keys. Commands use `bunny.cmd` keys, through request and respond only.
- **Request and respond.** One responder owns each key. A command carries `expiresat` and a `requestId`. The result is accepted, rejected in the shared error body, or `uncertain-result` at the deadline, and nothing retries it. A responder ignores a command past its expiry.
- **Delivery.** Each subscription and responder has its own bounded queue, so a slow handler delays only itself. A full subscription queue drops the message for that subscription and reports `capacity` through `onError`; a full responder queue refuses the request, and the requester gets `capacity`.
- **Trace context.** Every message carries W3C trace context. A message sent with a parent continues the parent's trace in a new span.
- **Plain objects.** The bus does not copy, serialize or validate messages. The tests check every message they see against profile 2.0.
- **Wiring.** The workspace joins `build` and `typecheck`, adds `test:sdk` and `test:sdk:built`, and the core CI job runs `test:sdk:built`.

## Decisions

Review accepted these four decisions on 2026-10-06:
- **Kind to key class.** State and removal messages use `bunny.state` keys, occurrences and outcomes use `bunny.event` keys, and commands use `bunny.cmd` keys through request and respond only. ADR 0012 names the three key classes. A consumer of an entity's state also sees its removal, an outcome reports what happened to a command, and a command has one owner, so it never goes through broadcast publish.
- **One responder per key.** A `respond` whose pattern overlaps another responder's is refused with `invalid-state`. ADR 0012 addresses each command to the one owner of what it changes, so a second owner is an error at registration instead of a race at delivery.
- **`requestId` in the command payload.** `request` writes `requestId` into the payload, and a caller may choose it, for example to record the request before sending. ADR 0012 says requests carry a `requestId`, and the profile's reply and outcome payloads name it.
- **Bounded queues, with the overflow signal deferred to #881.** The scope defaults require bounded queued work. A full subscription queue drops the message for that subscriber and reports `capacity` to `onError`, and a full responder queue refuses the request with `capacity`. The subscriber itself is not told about a dropped message. Until #881 adds an overflow signal that restarts sync, a subscriber can hold a silent gap in its copy; only `onError` sees it.

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
  - `docs/development.md`, for the SDK checks, and its specification inventory paragraph, which now points at `openspec/specs/` instead of keeping a stale list;
  - `docs/architecture.md`, which notes that the SDK's in-process bus exists as source.
- **Nothing else:** nothing runs the bus yet. There is no runtime, Hub, controller, contract or device change. Delivery target: source-only.

**No design.md.** ADR 0012 is the design record for the SDK. It states the in-process bus and its calls, routing keys, command expiry, no replay, the slow-consumer rule, trace context and portability, with their trade-offs and rejected alternatives. The omission also covers the four decisions above: each applies one of those ADR rules, and this proposal records its rationale. This change adds a library with no runtime, storage, migration or privacy behavior.
