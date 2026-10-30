## Context

The runtime builds every record with the contract's `createRecord` (`apps/runtime/src/record.ts`), which keeps only the
attributes the record's profile registers, and `errorFields` (`apps/runtime/src/log.ts`) turns an exception into
`error.type` and `error.code` only. The lint rule `bunny/no-raw-error-text` keeps every covered file from reading an
exception's message, stack or cause. ADR 0012's "Safe errors" says no record carries them. The owner's 2026-10-30
decision changes that for the private diagnostic path: the stderr journal the container keeps and the OTLP export to
the Mac-local collector that #813 wires. Nothing else changes: error bodies, health, history and proof keep registry
codes and fixed text.

## Goals / Non-Goals

**Goals:**
- A fault record that says what the exception said and where it arose, bounded and filtered, under a versioned
  profile that older consumers cannot accept by accident.
- One reader of exception text, tested with credential and payload canaries and hostile values.
- Loss and limits visible: how many segments were replaced, whether the text was cut.

**Non-Goals:**
- Exception text in error bodies, health, history, span names or MCP results.
- A lossless or durable archive, recovery machinery, or a change to collection and sharing choices (#777's deferred
  scope).
- Prompt, response or transcript capture (#425).
- Backend retention or export wiring (#813) and severity controls (#811).

## Decisions

- **A new profile, 1.7.** As #949, #835, #976 and #499 did, the additions are a catalog change with fixtures. Profile
  1.7 also admits `telemetry.dropped` under `bunny.runtime`, which #813 needs for the runtime's export loss summary, so
  that #813 consumes one profile instead of a 1.8 a week later. Rejected: adding to profile 1.6, which every consumer
  pins.
- **Fields and bounds.** `exception.message` is 1 to 1,024 characters, `exception.stacktrace` 1 to 4,096, so a fault
  record with its other attributes stays well within the contract's 8 KiB; the producer also bounds each text in UTF-8
  bytes, since the schema counts characters and the record limit counts bytes. `bunny.exception.redacted_count` and
  `bunny.exception.truncated` make filtering and cutting visible. The schema admits the four only together and only
  under the runtime's scopes: a text without its counts, counts without a text, or exception text on a hub host's
  record is invalid. Rejected: a free `error.stack`, which stays a negative fixture.
- **Projection removes, never fails.** `projectRecord` to a profile before 1.7 removes the four fields and keeps the
  rest, as 1.0 removes queue depth, so a consumer at an earlier profile keeps the fault's type, code and correlation
  and never receives the text. Other later-profile vocabulary still fails a projection, as before.
- **One serializer in the SDK.** `exceptionFields` (`packages/sdk/src/exception.ts`) is the one place that reads
  exception text, so modules and the runtime share its rules. It reads `message` and `stack` through own property
  descriptors: a data property as it is, an accessor only when it is V8's native stack accessor (checked by
  `Function.prototype.toString`), so a getter a value or its class defines is never invoked, and a value that is not an
  `Error` yields nothing. Rejected: reading `error.message` directly, which the lint rule forbids and which would run
  any getter; traversing `cause` or `errors`, which the issue excludes.
- **Filtering order.** The caller's filter first (the runtime passes `Redactions.scrub`, which replaces each secret a
  module read), then the credential rules (authorization and API-key values keeping a scheme word, URL user
  information, credential-named parameters and JSON members, well-known key shapes including `tok_`, long opaque runs
  with letters and digits outside a path), then the content rules (a JSON-shaped block before a quoted string, both
  over 128 characters, so a body's member names go with its values). Each replacement counts once. Rejected: dropping
  the whole record when a secret remains after filtering, which would hide the fault; `LogWriter` still drops a record
  whose attribute holds a registered secret, as a last resort.
- **Where the runtime writes them.** `faultFields` adds `exceptionFields` to `errorFields` for the runtime's fault
  records: `runtime.module.failed`, `runtime.module.refused` with an error, `runtime.handler.failed`,
  `runtime.module.stop-failed`, `runtime.module.error-after-stop` and `runtime.failed`. Decision and refusal records,
  `runtime.edge.failed` and `runtime.tracing.failed` keep the type only, as their specifications say. A module may use
  `exceptionFields` in its own `operation.failed`; #813's coverage pass decides where.
- **The lint rule stays.** `exception.ts` reads descriptors, not members, so `no-raw-error-text` has no finding there
  and needs no exception block; the rule keeps covering every other file. The static-analysis table names the file as
  the sanctioned reader.

## Risks / Trade-offs

- **A credential in an unknown shape.** A library that quotes a secret in a shape no rule knows, and that no module
  registered, reaches the private journal and export. Mitigation: the registered-secret filter covers every token a
  module reads from its secrets file; the long-opaque-run rule covers most keys; detection limits are documented, and
  publication keeps using synthetic fixtures. This is the trade-off the owner accepted.
- **Lost context.** The content rules may omit a long quoted path or a long JSON that was not a payload, and the
  long-run rule may redact a long identifier with digits. The counts show that something was replaced.
- **Record size.** A stack of 4,096 bytes plus a long message leaves about 2.5 KiB for the rest of the record; the
  runtime's fault records are far smaller than that.
