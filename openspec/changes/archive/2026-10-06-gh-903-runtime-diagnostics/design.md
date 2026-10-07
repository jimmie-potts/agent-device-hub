## Context

See proposal.md for why. The diagnostic contract requires a new profile and fixtures for any catalog extension, with contract review, cross-language fixtures and packaged-consumer checks. Its schema is the normative dictionary; the TypeScript validator is compiled from it, and the Python helper validates against it at run time. The runtime's watchdog thread loads only `record.ts`, never the SDK, to keep its memory small. The module test kit hosts modules without the runtime, which modules' tests cannot import.

## Goals / Non-Goals

**Goals:**
- Every record the runtime and its modules write passes the contract's validator, as maintenance intake reads it.
- Existing producers and their profile versions are unchanged; the Python helper needs no code change to validate the new records.
- A module cannot write an unregistered event, an unregistered attribute or the runtime's own events, and the kit catches a module that tries.

**Non-Goals:**
- OTLP export and Grafana (#813).
- Widening the contract's personal-data exclusions.
- A scope per module, and Python producers of profile 1.2.

## Decisions

**Profile 1.2 alongside 1.1, closed by the schema.** The additions live in the existing enums and attribute map, and a conditional subschema rejects each under `schema_version` 1.0 or 1.1. A projection to an earlier profile therefore fails for a record that uses one, and the Python helper validates 1.2 from the same schema without code changes. Alternative: separate schema files per profile. That duplicates the whole dictionary and needs a code path per language to pick one.

**The catalog states each profile's additions and the runtime scopes' rules.** `additions` and `scope_rules` make the closure and the rules data that tests check against the schema, so the two cannot drift. Alternative: rules only in the schema. A reader of the catalog could then not see which events a module may log.

**One `bunny.module` scope.** The module's name is the `bunny.module` attribute. A scope per module would grow the catalog with every module and make each new module a contract change (issue cut).

**Module events reuse the existing vocabulary where it fits.** A module logs the existing command, lifecycle, feed and operation events. Three module-generic events are new, because no existing event fits what the SDK's delivery rules make every module do: `message.received` (a consumer took a message by `(source, id)`), `outbox.republished` and `outbox.acknowledged`. Alternative: forcing these into `operation.completed`, whose `bunny.operation` enum has no fitting value.

**The runtime uses `createRecord`; the kit is strict.** `createRecord` fills the static body, checks the record and leaves out unregistered attributes, so no unknown field reaches a record in production, and an invalid record is dropped whole and counted, never truncated. The kit instead fails a module whose record would lose a field or be dropped, so the loss never reaches production unseen. Alternative: strict validation in the runtime too. A typo in one module field would then drop the whole record.

**A failure's reason becomes a code and a phase.** Health keeps `{code, detail}`. A record cannot hold the free-text detail, which may include a number and is not registered; it carries the 2.0 registry code in `bunny.code` and where the failure arose in `bunny.phase`. A refusal of a malformed name leaves the name out rather than lose the record.

**The resource is set once per process.** `log.ts` draws the process's `service.instance.id` at load, and every writer defaults to it, so `runtime.failed` from the process runner and the runtime's own records match. The watchdog thread receives the resource in its `workerData`, and the shared memory slots move to `lag.ts`, so the thread still never loads the SDK. `--environment` (after #920) sets `deployment.environment.name`, `development` by default, which the cutover sets to `production`.

**Edge records keep registered values.** #920 wrote the listener's URL and the registry code's meaning, a sentence, in `bunny.reason`, an existing enum attribute whose type no later profile may change. The records now carry `server.port` and, in `bunny.reason`, a fixed table from each registry code to the contract's reason (none for `internal` or `uncertain-result`); the meaning stays derivable from `bunny.code`. A test keeps the table in step with the registry and the catalog.

**Runs are a test environment.** `--environment` defaults to `development`; the installed unit sets `production` at the cutover, and the disposable runs of #920 pass `test`. The contract has no `verification` environment, and adding one would be another catalog change. `build-current` watches the contract's sources and outputs, because the run now loads them.

**A failing sink never matters.** The writer catches a throwing sink and counts it. The stderr sink adds an `error` listener before its first write, because a closed stderr pipe reports EPIPE as a stream error, which would otherwise escape to the process and fail a module or the runtime. The watchdog thread catches a failed `writeSync` and still kills the process.

## Risks / Trade-offs

- [The kit and the runtime build the record separately] → The kit's check uses the same catalog, scope, schema version and provenance, and the runtime tests check every record they collect with the contract's validator.
- [A module record that fails the contract is lost in production] → The kit fails such a module in its tests, and the writer counts the drop.
- [The watchdog thread now loads the contract's validator] → It loads only the pure entry point, no Pino or SDK; its resident memory grows by the validator's code.
- [Artifact 1.2.0 changes the Hub's bundled archive] → The Hub's records keep profile 1.1, and the Hub package check runs against the new archive.
