## Why

[Hub #903](https://github.com/jimmie-potts/agent-device-hub/issues/903) is wave 3, lane B, of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). ADR 0012 says log lines follow the [diagnostic contract](../../../docs/observability-contract.md). The runtime from #880 writes JSON records with OpenTelemetry field names, but they are not contract records: they lack `schema_version`, the registered static `body`, a scope version and three resource fields, and the catalog of `@jimmie-potts/bunny-observability` 1.1.0 registers no runtime service, scope, event or attribute. Maintenance intake accepts only records the contract's `parseRecord` validates, so after the cutover (#840) it would read nothing from the runtime. The #880 Specification review found this (PR #899).

## What Changes

- **Profile 1.2, artifact 1.2.0.** The contract's catalog and schema add the `runtime` service, its `bunny.runtime` scope and one `bunny.module` scope for every module, the runtime's events, three module events and the attributes they use. Profiles 1.0 and 1.1 reject every addition, so a 1.2 record that uses one never projects to an earlier profile. The catalog lists each profile's additions and the rules of the two runtime scopes: each belongs to the `runtime` service and allows only its own events, and a `bunny.module` record must name its module. Producers still default to 1.1. The shared fixtures add the runtime's records and their negative controls; the Python conformance suite runs unchanged against them.
- **The runtime's records.** Every record is built by the contract's `createRecord` as a profile 1.2 record: the resource (service `runtime`, the package's version, a neutral `service.instance.id` per process and `deployment.environment.name`), scope version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The contract drops a record with an unregistered event or an invalid value whole, and the writer counts it. A module's failure names its 2.0 registry code and where it arose, not the free-text reason. The watchdog thread's `runtime.stuck` record carries the main thread's resource.
- **Module records.** A module's records have the one scope `bunny.module` and the attribute `bunny.module`. A module may log only the events the catalog registers for modules. The module test kit (#882) fails a module that logs an unregistered event or attribute, or a value outside its registered type. The fixture modules log registered events.
- **A failing sink.** A sink that throws loses its record, and a closed stderr is ignored, so neither changes what the runtime does.
- **Maintenance.** A new intake test runs the built runtime and reads its stderr lines as a synthetic journal.
- **Launch files, after #920.** The `--environment` argument sets `deployment.environment.name`; the process's instance ID reaches every writer and the watchdog; the edge records from #920 are registered.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `shared-observability-contract`: adds profile 1.2 and its runtime vocabulary.
- `bunny-runtime`: the runtime's and its modules' records become diagnostic-contract records.
- `bunny-sdk`: the module test kit checks a module's log records.

## Impact

- **Source:** `packages/observability` (catalog, schema, fixtures, `projectRecord`, version 1.2.0); `apps/runtime/src` (`record.ts`, `log.ts`, `host.ts`, `lag.ts`, `watchdog.ts`, `watchdog-worker.ts`, and after #920 the launch files); `packages/sdk/src/testing`.
- **Consumers:** the workspace pins of `apps/hub`, `apps/maintenance` and `modules/pixoo/packages/media` move to 1.2.0 with the archive names in `scripts/package-hub.mjs` and `scripts/package-maintenance.mjs`; `apps/runtime` and `packages/sdk` gain the dependency. Their own records keep profile 1.1.
- **Tests:** profile 1.2 tests and fixtures in `packages/observability`; the runtime's record, sink and process tests; the kit tests; the maintenance intake test.
- **Docs:** the contract, the observability, runtime, SDK, maintenance and Pixoo READMEs, and `docs/development.md`.
- **Not included:** OTLP export and Grafana (#813), personal content in diagnostics (ADR 0011), existing services' records and profiles, and pointing maintenance intake at the runtime's unit, which the cutover (#840) does. Delivery target: source-only.
