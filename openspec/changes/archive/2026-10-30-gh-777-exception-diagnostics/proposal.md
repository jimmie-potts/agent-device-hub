## Why

A failure in the B.U.N.N.Y. runtime or one of its modules reaches the diagnostic journal as a registry code and an
exception's type, by ADR 0012's "Safe errors" rule, so the owner cannot tell from the log what a module's error said or
where it arose. On 2026-10-30 the owner accepted private exception messages and stack traces in diagnostic records for
[epic #810](https://github.com/jimmie-potts/agent-device-hub/issues/810), so that the Mac-local log and trace viewer
(#813) shows a failure's context. [#777](https://github.com/jimmie-potts/agent-device-hub/issues/777) owns the
coordinated ADR, contract, specification, implementation and consumer change; the tracker decision alone changes no
released schema.

## What Changes

- **Profile 1.7.** The diagnostic contract registers `exception.message`, `exception.stacktrace`,
  `bunny.exception.redacted_count` and `bunny.exception.truncated`, admitted only together and only under
  `bunny.runtime` and `bunny.module`, and admits `telemetry.dropped` under `bunny.runtime` for the export loss summary
  #813 records. Artifact 1.7.0; every earlier profile refuses each addition; a projection to an earlier profile removes
  the four fields and keeps the record. The specification also gains the profile 1.6 requirement the source already
  ships (#499) and the specification lacked.
- **One serializer.** The SDK's `exceptionFields` reads only an `Error`'s own `message` and V8's own `stack`, replaces
  registered secrets, credential-like segments and payload-like segments, counts the replacements and bounds each text.
- **The runtime's fault records** carry the result, through `faultFields`; decision and refusal records keep the type
  and code only. The runtime writes at profile 1.7 and the SDK kit checks a module's records at 1.7.
- **ADR 0012 "Safe errors"** gains its one private-path exception, dated 2026-10-30.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shared-observability-contract`: profile 1.7 registers the private exception context and the runtime's telemetry-loss
  summary; the allowlist rule names its one exception; profile 1.6 is recorded.
- `bunny-sdk`: filtered exception fields through one serializer.
- `bunny-runtime`: the runtime's records are profile 1.7, and its fault records carry the filtered exception text.

## Impact

- **Code:** `packages/observability` (catalog, schema, fixtures, TypeScript and Python helpers, tests, packaging),
  `packages/sdk/src/exception.ts` and its export, the level table's `telemetry.dropped`, the kit's record check,
  `apps/runtime/src/log.ts` (`faultFields`, `Redactions.scrub`), `host.ts`, `process.ts` and `record.ts`.
- **Version pins:** `@jimmie-potts/bunny-observability` 1.7.0 in `apps/hub`, `apps/maintenance`, `apps/runtime`,
  `apps/bb8-windows` and `packages/sdk`, the lockfile and the packaging script.
- **Unchanged:** error bodies, health, history, proof, span names and their fixed text; the maintenance intake's
  findings, which carry catalog enums only; collection and sharing choices; application behavior on any diagnostic
  failure.
- **Delivery:** source now; the installed check is batched with #813's Mac installation.
