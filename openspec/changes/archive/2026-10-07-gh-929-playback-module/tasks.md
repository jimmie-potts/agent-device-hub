## 1. Module

- [x] 1.1 Copy the Hub's playback, Sony, Sonos and common code with provenance notes, and translate its source, ranking, freshness and configuration tests under the strict profile (`sources.test.ts`, `presentation.test.ts`, `configuration.test.ts`).
- [x] 1.2 Assert the kit with policy A's offline check, the record and its revisions, staleness at 5 s and 30 s with titles withheld, both speakers offline at start, commands to the presented speaker only, no redirect and no retry of an uncertain command, a refused command, commands one at a time, bounded duplicates, a crash between intent and outcome, rising revisions and polling over HTTP without overlap (`module.test.ts`). These were written just after the module, not red before it; the negative controls in 3.3 stand in for that evidence.
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

## 4. Review fixes (PR #966)

- [x] 4.1 Report a speaker's refusal as `failed` with evidence `transmitted`, and an action that was never sent as `failed` with `none`, red first (`module.test.ts`, `sources.test.ts`); add the receipt note and correct the `observedAtMs` and `ageMs` rows in MAPPING.md.
- [x] 4.2 Show the intent stored before the speaker hears a command, the reply after the outcome's commit and publication, and a stop that ends a hung call with an `uncertain` outcome and nothing left behind (`module.test.ts`).
- [x] 4.3 Keep database refusals in the module: `capacity` for a refused intent, `accepted` and a capped-backoff retry for a refused outcome, and one `operation.failed` and one `operation.completed` per run of refusals across every commit, red first (`module.test.ts`).
- [x] 4.4 Admit a queued command after the read that follows the command ahead, red first (`module.test.ts`).
- [x] 4.5 Configure the shipped modules from each factory's `simulatedSection`, as #844 does: the maintenance journal test, the shipped process tests, the `shipped` run and the catalog.
- [x] 4.6 State the reply's exception to ADR 0012 in the README and the spec, and correct the `shipped` run's wording.
- [x] 4.7 Show each fix's mutant fails its named tests, and rerun the gate.
