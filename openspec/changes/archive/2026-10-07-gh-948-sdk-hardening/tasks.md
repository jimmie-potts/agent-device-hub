## 1. Responder results

- [x] 1.1 Assert, red against the old code, that a responder throwing before or after a simulated effect, throwing a nested `SdkError` or answering with a non-reply ends `uncertain` with no reply, its error reported once and its command handled once with no resend: `request.test.ts` in process and `conformance.test.ts` on both transports.
- [x] 1.2 Settle those requests `uncertain` in the bus, and send `{"status": "uncertain"}` from the remote client, which the edge settles through the bus's `failed` marker.
- [x] 1.3 Update the runtime's isolation test, whose failing responder now leaves its request uncertain.

## 2. Safe edge errors

- [x] 2.1 Assert, red against the old code, that an edge exception carrying `tok_SYNTHETIC123` reaches no response, edge log record or reported error (`remote.test.ts`), and no runtime response, log record or health report (`apps/runtime/tests/safe-errors.test.ts`).
- [x] 2.2 Answer unexpected exceptions with the fixed `internal` detail `the edge failed`.

## 3. Committed is not rolled back

- [x] 3.1 Assert, red against the old code, that a commit whose publish is refused resolves, leaves its rows unpublished, is tried once and not again on its own, and goes out unchanged, with its trace context, with the next transaction or start.
- [x] 3.2 Resolve `transaction` with the work's result once committed, whatever the publish did.

## 4. Typed codes and no `tracestate`

- [x] 4.1 Add a parity test of `RETRYABLE` against `errors.json` and type-level checks that a non-registry code does not compile, red before the table exists.
- [x] 4.2 Add `ErrorCode`, `RETRYABLE` and `isErrorCode`, and type `errorBody`, `ErrorDetail`, the edge's log record and the kit's refused code with `ErrorCode`.
- [x] 4.3 Assert, red against the old code, that `childOf` passes on only `traceparent` and that a message carrying `tracestate` is refused; drop it from `childOf`, `TraceContext`, the v2 `Message` type and the envelope schema, with a fixture case.

## 5. Policy A text and qualification

- [x] 5.1 State policy A in the runtime host's header comment, the SDK README and the module test kit.
- [x] 5.2 Run build, typecheck, lint, the SDK, event, runtime, scenario, app-verify, maintenance and workflow checks, and OpenSpec validation.
- [x] 5.3 Show negative controls fail named tests: the old edge detail, responder throws refused again, the outbox rejecting after commit, a flipped `retryable` flag, an unknown code, and `tracestate` forwarded again.
- [x] 5.4 Synchronize the affected specifications and archive the change.

## 6. Review fixes (PR #956)

- [x] 6.1 Cover a nested `SdkError`, a non-reply and malformed refusals on both transports, passing every deadline on an injected scheduler; show mutants M7 and M8 killed.
- [x] 6.2 Accept a refusal only with a registered code and that code's flag, in process, at the edge and at the client; show mutant M9 killed.
- [x] 6.3 Answer an edge failure after dispatch with `uncertain-result`, settle a command whose request call is answered `internal` as `uncertain`, and encode an answer before writing its headers.
- [x] 6.4 Report a refused outbox publish once per run of refusals, take an optional validator in `add`, and document the refusal that lasts.
- [x] 6.5 Say that a refusal's detail may quote what the caller sent, and record that the change has observable behavior through the runtime's edge.
