## Why

[ADR 0012](../../../../docs/decisions/0012-bunny-event-platform.md)'s "Errors, effects and outcomes" section, added by the 2026-10-07 amendment ([#947](https://github.com/jimmie-potts/agent-device-hub/issues/947)), separates why a request failed from what may have happened. The SDK still breaks several of its rules. A responder that throws after its handler started is refused as `internal`, though it may have acted. The remote edge puts an exception's message into its response and log record. An outbox transaction that committed rejects when its publish is refused, so a caller can mistake committed work for a rollback. Error codes are plain strings, and `tracestate` is still forwarded although the diagnostic contract disables it. [Hub #948](https://github.com/jimmie-potts/agent-device-hub/issues/948) brings the SDK and profile 2.0 into line before #831 and #919 build on them.

## What Changes

- **Responder results.** A responder that returns an error body is a rejection. Any exception once its handler started, an `SdkError` from a nested call included, ends the request `uncertain` with `uncertain-result`, in process and remote. Refusals the SDK or the edge make before a handler starts stay rejections.
- **Remote answer form.** A remote responder whose handler fails answers the edge's `reply` call with `{"status": "uncertain"}`, and the edge settles the request as the bus does in process. `sdk-remote/1.0` is unreleased, so the form is added without a version change.
- **Valid refusals only.** A refusal counts only with a registered code and that code's flag, in process, at the edge and at the client. A malformed one ends the request `uncertain`.
- **Safe edge errors.** The edge answers an unexpected exception with `internal` and the fixed detail `the edge failed`, in the response and its log record, or with `uncertain-result` once it has handed a command to its bus. The exception stays in memory. The client settles a command whose request call the edge answers `internal` as `uncertain`.
- **Committed is not rolled back.** `Outbox.transaction` resolves with the work's result once the work commits and its publish ends, and never rejects after the commit. Refused messages stay stored with their `id`, `time` and trace context, and the next transaction or start sends them unchanged. The refusal goes to the outbox's `onError` as committed and awaiting publication, once per run of refusals, and an optional validator keeps a message the edge would refuse out of the outbox.
- **Typed registry codes.** `@jimmie-potts/event-contracts/v2` exports `ErrorCode`, a literal union, and `RETRYABLE`, each code's fixed flag, kept equal to `schemas/v2/errors.json` by a parity test. `errorBody`, `ErrorDetail`, the edge's log record and the kit's refused code take `ErrorCode`.
- **No `tracestate`.** `childOf` passes on only `traceparent`, `TraceContext` and the v2 `Message` type drop `tracestate`, and the 2.0 envelope schema refuses it as an undeclared attribute.
- **Policy A text.** The runtime host's header comment, the SDK README and the module test kit say that device errors and timeouts become outcomes and `unavailable` device state, and only an escaped error stops a module.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: request results and valid refusals, trace context, the remote transport's failed responders, safe errors and edge failures after dispatch, the conformance suite and the outbox's committed result and its report.
- `bunny-message-profile`: the envelope defines no `tracestate`, and the registry's codes are a type.

## Impact

- **Code:** `packages/event-contracts` (`src/v2/errors.ts`, `src/v2/index.ts`, `schemas/v2/envelope.schema.json`), `packages/sdk` (`sdk.ts`, `trace.ts`, `refusal.ts`, `in-process.ts`, `remote-client.ts`, `remote-edge.ts`, `remote-protocol.ts`, `outbox.ts`, `testing/kit.ts`), the `apps/runtime/src/host.ts` header comment and the edge-log comment in `apps/runtime/src/runtime.ts`.
- **Tests:** the SDK's request, conformance, remote, outbox, trace and registry tests; the profile's fixtures and parity test; the runtime's isolation test, a new safe-errors test and the scenario harness's crash comment.
- **Docs:** the SDK, event contracts and runtime READMEs.
- **Unchanged:** #921's dependency-free code copies in app-verify and maintenance and their equality tests, the registry itself, the edge's authentication and validation order, and released 1.x contracts.
- **Delivery:** source-only, with observable behavior. A runtime run with `--edge` (`verify:runtime`) serves the SDK's edge, and two of its HTTP answers change: a remote responder that fails once it started now leaves the request `uncertain`, and an edge exception's detail is fixed text. The change therefore gets an Acceptance review in a `verify:runtime` run.
