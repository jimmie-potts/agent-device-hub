## 1. One publication without a stream (SDK)

- [x] 1.1 Assert, red against stubs (9 of 9 failing), a message published in one call with no stream, the edge's refusals as `rejected` with its body and the trace ID, an edge never reached as `unavailable`, a silent edge as `uncertain` at the deadline, a failed or foreign answer as `uncertain`, the call's headers, and a malformed call refused before anything is sent (`packages/sdk/tests/remote-publish.test.ts`).
- [x] 1.2 Implement `prepareMessage` and `publishOnce` with `node:http`, telling a call that never connected from one that lost its answer (`packages/sdk/src/remote-publish.ts`), and document them in the SDK README.

## 2. The 2.0 agent hook

- [x] 2.1 Assert, red against a hook that publishes nothing (6 of 10 failing; the 4 pure mapping and reading tests were written with their code), a session through five hooks with an unchanged 1.x producer file, each lifecycle version, the intake record's trace, every producer file and receipt the hook may not use, unmapped input, a stopped runtime, a refused credential, a silent runtime and stdin left open within the budget, the producer's grant, the credential ID against the Hub's and the conversion's, and every 1.x kind's round trip through the core's mapping (`apps/runtime/tests/hook.test.ts`).
- [x] 2.2 Implement the producer file's checks and the converted source (`src/hook/producer.ts`), the 1.x-to-2.0 mapping (`src/hook/observation.ts`), the hook (`src/hook/hook.ts`), the `./hook` export and `bin/monitor-hook.mjs`, which arms its deadline before it loads anything.
- [x] 2.3 Measure the hook end to end against a disposable runtime (`scripts/measure-hook.mjs`): 25 runs, median 151 ms, worst 158 ms, all accepted; a stopped runtime 153 ms; a silent one 2.91 s.

## 3. The Codex Desktop module

- [x] 3.1 Assert, red against a module that never reads (9 of 9 failing), the read rules on published observations, the settle rule, an unusable marker logged once, evidence once per revision, a stalled folder before and after the first read, a failing reader's backoff, a stop during a stalled read and what leaves the module (`modules/codex-desktop/tests/module.test.ts`); port the parser, configuration and read cases (`marker.test.ts`, `configuration.test.ts`); pass the module test kit (`kit.test.ts`).
- [x] 3.2 Implement the configuration and conversion, the marker read, the reader process and its transport, the read rules, the module and the simulated marker; measure the reader process's memory (49 MiB resident against 44 MiB for an idle Node process).
- [x] 3.3 Add the module to the shipped list, last (after the Tidbyt module at first, after the Nanoleaf module once rebased onto #968), and test it with the real core and the real reader, a stuck reader included (`apps/runtime/tests/codex-desktop.test.ts`); take each shipped module's API version from its manifest in the process test.

## 4. Both tiers

- [x] 4.1 Add `agent-hooks` and `codex-desktop-read` to the catalog, the `hook` call and the producer credential to the harness contract, and play them in the in-memory harness on both transports.
- [x] 4.2 Play them in disposable runs: the supervisor writes the producer file, holds the simulated marker over IPC and holds the runtime stopped for a restart's `holdMs`; serve and watch the hook script and the module's build (`build.test.ts`).

## 5. Documentation, checks and closure

- [x] 5.1 Document the hook, the helper, the module and the runs in the runtime, SDK, module and verify READMEs and `docs/development.md`; run `test:codex-desktop:built` in the core CI job, with `tests/workflow_checks.cjs`.
- [x] 5.2 Show each protection's mutant fails its named tests.
- [x] 5.3 Run the gate on a committed head, synchronize the affected specifications and archive the change.
