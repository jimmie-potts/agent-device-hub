## Why

The device modules of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) (#832's children, #843, #844) and the CHOMPI module (#837) need device addresses, credentials and private files, and the module API from #880 gives a module only its SQLite database. [Hub #919](https://github.com/jimmie-potts/agent-device-hub/issues/919) adds configuration, secrets, a private folder and a bounded worker call to the SDK's module context and to `apps/runtime`, once, before the first device module. It also turns the owner's module failure policy A (2026-10-06, [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) "Failure isolation", amended 2026-10-07) into an executable check in the module test kit. Secrets follow [ADR 0011](../../../docs/decisions/0011-private-personal-data-retention.md): they never enter messages, logs, health, error bodies or proof.

## What Changes

- **Module API 1.1 (additive).** The manifest may declare a synchronous `configure(section)` that returns `{config, devices?}` or a refusal from `errorBody`. The context gains `config`, `secrets.read(name)`, `files()` and `workers.call(file, request, {timeoutMs, signal?, transferList?})`. `checkConfiguration(manifest, section)` is the admission check the runtime and the kit share, and `WorkerCalls` the worker call both hosts use. A `1.0` module is still accepted.
- **One private configuration file.** `--config <file>` (`RuntimeOptions.configFile`) reads `{"schema": "runtime-config/1.0", "modules": {<name>: <section>}}`. It follows #880's private-state rules (no link along the path, outside Git checkouts and `/mnt`, a private regular file with one link, at most 1 MiB), or the runtime refuses to start with a `config-*` code. #835 adds the edge's section to the same file.
- **Admission per module.** In list order, the runtime checks each module's own section, the devices it names against those of earlier modules (#918's routing-ID hand-off), and each secret file the section names. A failing module is `refused` alone, with a registry code and fixed detail in health and `bunny.code` with the `manifest` phase in its record; the others start.
- **Secrets.** `secrets.read(name)` reads only a file the module's own section names, checked again on each read under the same private-file rules (at most 64 KiB, UTF-8). The log writer drops, and counts, any record whose attribute holds a secret a module read. No refusal quotes a file.
- **Private folders.** `files()` is `modules/<name>/` beside the module's SQLite file, mode 700, never created through a link.
- **Worker calls.** One request and one reply in a new worker thread, with a deadline on the runtime's scheduler, cancelled when the module stops, at most four running per module. A failed call rejects only that call. A worker a module starts with its own `env` keeps the process's `NODE_OPTIONS`, closing #920's guard gap.
- **Policy A in the kit.** `ConformanceSpec` gains `config`, `secrets` and `offline`. The new offline check fails a module whose start does not finish within 1000 ms while its device never answers, or that never reports the device `unavailable`. Every check fails a module whose message, record, reply or synced state carries one of its secrets.
- **Fixtures and tiers.** A configured fixture sign shows the pattern and passes the kit. The scenario catalog gains `configured-module` and `misconfigured-module`, played in the in-memory harness (tier 1) and in disposable runs (tier 2), whose seeds write a private configuration file with a synthetic token and start the runtime with `--config`.
- **Policy A wording.** The runtime's isolation test header and start-timeout test title are reworded under policy A, as #948 and PR #955's review handed off.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: module API version 1.1 in health and admission, the module context's configuration, secrets, folder and worker calls, private files and folders, the new "Module configuration" requirement, the configured fixture sign, the catalog's configured scenarios, and configured disposable runs.
- `bunny-sdk`: configuration checks beside the manifest checks, the module test kit's configuration, secrets and policy A check, and the new "Bounded worker calls" requirement.

## Impact

- **Code:** `packages/sdk` (`module.ts`, `workers.ts`, `index.ts`, `testing/harness.ts`, `testing/kit.ts`); `apps/runtime/src` (`host.ts`, `state.ts`, `log.ts`, `runtime.ts`, `process.ts`, `main.ts`, `index.ts`); `apps/runtime/verify` (`child.ts`, `supervisor.ts`, `seed.ts`, `protocol.ts`, `adapter.ts`).
- **Tests:** the SDK's new configuration and worker call tests and kit tests; the runtime's new configuration and sign tests, its manifest, isolation and process tests, the fixture sign and its workers, the catalog and in-memory harness, and the verify steps test.
- **Docs:** the SDK, runtime and verify READMEs.
- **Unchanged:** the observability catalog (configuration refusals use the registered `manifest` phase), the shipped module list (still empty), the edge grants file, released 1.x contracts, root manifests, the lockfile, CI and `docs/development.md`.
- **Delivery:** source-only, with observable behavior: a disposable run with `--config` shows a configured module running or `refused` in health, so the change gets an Acceptance review in `verify:runtime` runs. Installation is batched into the cutover (#840), whose installer (#935) writes the configuration file.
