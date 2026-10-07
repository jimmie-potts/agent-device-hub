## Context

ADR 0012's "Errors, effects and outcomes" rules are settled; this change applies them to the SDK. Three of them need a design choice: how a remote responder reports a failure, what a committed outbox transaction returns when its publish is refused, and where the typed code table lives.

## Goals / Non-Goals

**Goals:**
- A request is `rejected` only when it had no effect, on both transports, with the same detail.
- No exception's message reaches a response or log record at the edge.
- No caller can take committed outbox work for a rollback.
- A code outside the registry fails to compile.

**Non-Goals:**
- Records and spans at decision points ([#949](https://github.com/jimmie-potts/agent-device-hub/issues/949)), including a record for a publish the outbox deferred.
- The kit's executable policy A check ([#919](https://github.com/jimmie-potts/agent-device-hub/issues/919)).
- Tracker and acknowledgment durability ([#782](https://github.com/jimmie-potts/agent-device-hub/issues/782), [#831](https://github.com/jimmie-potts/agent-device-hub/issues/831)).

## Decisions

- **Every exception after the handler started is `uncertain`.** The bus cannot tell a throw before an effect from one after it, so it takes the conservative answer. A responder that can refuse returns its error body. A nested `SdkError` is no exception: it may follow an effect too. Rejected: treating a thrown `SdkError` as a typed refusal, which would let a refusal from a nested call claim no effect.
- **The remote answer is `{"status": "uncertain"}` in the `reply` call.** It is the smallest form: the call, its routing fields and its matching by command message id are unchanged, and the edge maps it to the bus's internal `failed` marker, which settles the request as a local throw does, with the same detail. The edge builds no reply message for it. A remote part could already make a request uncertain by not answering until the deadline, so this grants nothing new. Rejected: a new call, and a missing `reply`, which reads as a malformed call.
- **The outbox resolves after the publish ends, success or not.** Waiting keeps the success path as it was: when `transaction` resolves, its messages have gone out if they could. A refused publish leaves the rows unpublished, and the existing sends pick them up in order. No caller needs to tell a deferred publish apart, so the result type is unchanged. Rejected: a distinct committed-pending result, which every caller would unwrap for a case none acts on, and resolving at the commit, which would change the order callers see.
- **No log record for a deferred publish yet.** The diagnostic catalog has no `bunny.module` event that fits, and the catalog is outside this change. #949 owns the record.
- **An `as const` table in `src/v2/errors.ts`.** `RETRYABLE` lists the registry's codes in its order with literal flags, and `ErrorCode` is its key union. A parity test compares it with `errors.json` entry by entry, and the existing test compares `errors.json` with the error block. `errorBody` takes its flag from the table and still throws on an unregistered code from an untyped caller. Rejected: generating the file, which adds a build step for eighteen lines.
- **One validity check for refusals** (`refusal.ts`, review fix). A refusal counts only with a registered code and that code's flag, rebuilt with at most 1024 characters of detail. The bus, the remote client and the edge share it, so a malformed body ends the request `uncertain` on both transports instead of claiming no effect, and the client never passes on an edge body outside the registry.
- **An edge failure after dispatch is `uncertain-result`** (review fix). The edge marks a call once it hands a command to its bus, and answers a later unexpected exception with `uncertain-result`. The client cannot tell where the edge failed, so it settles a command whose request call is answered `internal` or `uncertain-result` as `uncertain`. The edge also encodes an answer before it writes the headers, so a body that cannot be encoded still gets an answer.
- **A refused publish is reported, once per run** (review fix). The outbox reports it to an `onError` option with the bus's signature: an `SdkError` with the refusal's code and the fixed detail `committed, awaiting publication`, with the refusal as its `cause`. The default is the bus's `BunnySdkWarning`. It reports again only after a send goes through or the code changes. Rejected: reporting through the bus's `onError`, which the runtime treats as a module failure, and a catalog record, which #949 owns.
- **An optional validator in `add`** (review fix). The outbox has no schemas of its own, so it takes the caller's validator, such as its edge's, and rolls back a message that validator refuses. Without one, a refusal that lasts holds back every later message in commit order; dropping or reordering would lose an outcome or break order.
- **`tracestate` is an undeclared attribute.** Removing it from the envelope schema makes the validator refuse it through `additionalProperties`, with the detail every other undeclared attribute gets.

## Risks / Trade-offs

- [More `uncertain` results need a person] → ADR 0012 accepts this; modules refuse with an error body before acting.
- [A deferred publish has no diagnostic record until #949] → The outbox reports it to its `onError`, and the rows go out with the next transaction or start.
- [A refusal that lasts blocks the outbox] → A caller passes its edge's validator; otherwise the report names the code, and the messages wait in order.
- [The simulated crash in the scenario harness no longer ends the lamp's work at its throw] → The old lamp only answers on the old bus, which nobody hears; the scenario still checks the republish after the restart.
