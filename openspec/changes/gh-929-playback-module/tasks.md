## 1. Module

- [x] 1.1 Copy the Hub's playback, Sony, Sonos and common code with provenance notes, and translate its source, ranking, freshness and configuration tests under the strict profile (`sources.test.ts`, `presentation.test.ts`, `configuration.test.ts`).
- [x] 1.2 Assert, red before the module existed, the kit with policy A's offline check, the record and its revisions, staleness at 5 s and 30 s with titles withheld, both speakers offline at start, commands to the presented speaker only, no redirect and no retry of an uncertain command, a refused command, commands one at a time, bounded duplicates, a crash between intent and outcome, rising revisions and polling over HTTP without overlap (`module.test.ts`).
- [x] 1.3 Add the module: configuration and conversion, the transport and simulated speakers, polling on the runtime's scheduler, the record, sync, commands with stored intent and the outbox, and diagnostics.

## 2. Runtime

- [x] 2.1 Ship the module's factory after the core, and update the shipped-process, configuration and log tests for the refused module.
- [x] 2.2 Add the `speaker-playback` scenario and the playback simulations to the catalog and the in-memory harness, and reach the supervisor's simulated speakers over the run's IPC channel.
- [x] 2.3 Watch the module's sources and build in the run's build check.

## 3. Wiring, documentation and qualification

- [x] 3.1 Add the workspace, build, typecheck and `test:playback` scripts, the runtime's dependency, the lockfile entry and the core CI job's step.
- [x] 3.2 Document the module, its record for #843 and #930, the runtime and run READMEs, docs/development.md, docs/architecture.md and MAPPING.md's rename rule.
- [x] 3.3 Run the gate and show the negative controls fail named tests.
- [x] 3.4 Synchronize the affected specifications and archive the change.
