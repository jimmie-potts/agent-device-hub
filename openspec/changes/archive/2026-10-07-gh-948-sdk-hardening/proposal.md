## Why

[ADR 0012](../../../../docs/decisions/0012-bunny-event-platform.md)'s "Errors, effects and outcomes" section, added by the 2026-10-07 amendment ([#947](https://github.com/jimmie-potts/agent-device-hub/issues/947)), separates why a request failed from what may have happened. The SDK still breaks several of its rules. A responder that throws after its handler started is refused as `internal`, though it may have acted. The remote edge puts an exception's message into its response and log record. An outbox transaction that committed rejects when its publish is refused, so a caller can mistake committed work for a rollback. Error codes are plain strings, and `tracestate` is still forwarded although the diagnostic contract disables it. [Hub #948](https://github.com/jimmie-potts/agent-device-hub/issues/948) brings the SDK and profile 2.0 into line before #831 and #919 build on them.

## What Changes

- **Responder results.** A responder that returns an error body is a rejection. Any exception once its handler started, an `SdkError` from a nested call included, ends the request `uncertain` with `uncertain-result`, in process and remote. Refusals the SDK or the edge make before a handler starts stay rejections.
- **Remote answer form.** A remote responder whose handler fails answers the edge's `reply` call with `{"status": "uncertain"}`, and the edge settles the request as the bus does in process. `sdk-remote/1.0` is unreleased, so the form is added without a version change.
- **Safe edge errors.** The edge answers an unexpected exception with `internal` and the fixed detail `the edge failed`, in the response and its log record. The exception stays in memory.
- **Committed is not rolled back.** `Outbox.transaction` resolves with the work's result once the work commits and its publish ends, and never rejects after the commit. Refused messages stay stored with their `id`, `time` and trace context, and the next transaction or start sends them unchanged.
- **Typed registry codes.** `@jimmie-potts/event-contracts/v2` exports `ErrorCode`, a literal union, and `RETRYABLE`, each code's fixed flag, kept equal to `schemas/v2/errors.json` by a parity test. `errorBody`, `ErrorDetail`, the edge's log record and the kit's refused code take `ErrorCode`.
- **No `tracestate`.** `childOf` passes on only `traceparent`, `TraceContext` and the v2 `Message` type drop `tracestate`, and the 2.0 envelope schema refuses it as an undeclared attribute.
- **Policy A text.** The runtime host's header comment, the SDK README and the module test kit say that device errors and timeouts become outcomes and `unavailable` device state, and only an escaped error stops a module.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: request results, trace context, the remote transport's failed responders and safe errors, the conformance suite and the outbox's committed result.
- `bunny-message-profile`: the envelope defines no `tracestate`, and the registry's codes are a type.

## Impact

- **Code:** `packages/event-contracts` (`src/v2/errors.ts`, `src/v2/index.ts`, `schemas/v2/envelope.schema.json`), `packages/sdk` (`sdk.ts`, `trace.ts`, `in-process.ts`, `remote-client.ts`, `remote-edge.ts`, `outbox.ts`, `testing/kit.ts`), the `apps/runtime/src/host.ts` header comment.
- **Tests:** the SDK's request, conformance, remote, outbox, trace and registry tests; the profile's fixtures and parity test; the runtime's isolation test, a new safe-errors test and the scenario harness's crash comment.
- **Docs:** the SDK, event contracts and runtime READMEs.
- **Unchanged:** #921's dependency-free code copies in app-verify and maintenance and their equality tests, the registry itself, the edge's authentication and validation order, and released 1.x contracts.
- **Delivery:** source-only. Nothing serves the SDK yet.
