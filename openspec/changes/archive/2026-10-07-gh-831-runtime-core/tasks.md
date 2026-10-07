## 1. The core and its store

- [x] 1.1 Map 2.0 `lifecycle` observations to lifecycle 1.2 envelopes and stored sessions to `session/2.0` records at an instant (`src/core/mapping.ts`).
- [x] 1.2 Copy the Hub's storage adapter into the core store with provenance notes, and commit each change with its messages, records, history and the intake's `(source, id)` in one transaction through the SDK's outbox (`src/core/store.ts`).
- [x] 1.3 Run the owner as the module `core` with the source `bunny/core`, first in the shipped list, with intake, publication, sync, the freshness timer, `notice-acknowledge` and the extension point (`src/core/core.ts`); end the runtime with `core-failed` when the core fails.
- [x] 1.4 Make the fixture core the real core with stand-in parts for history, the inbox and the mode.

## 2. Tests

- [x] 2.1 The store tests (`tests/core-store.test.ts`, 15) and the core tests (`tests/core.test.ts`, 8 plus the module test kit's 4 checks) were written alongside the code, not before it; each failure path's test is shown red by a negative control in section 4.
- [x] 2.2 The shipped-runtime process and log tests went red when the shipped list gained the core (health listed `core`; two more records), and were updated to the new list.
- [x] 2.3 Add process tests: a kill between the core's commit and its publish, a core that cannot read its store, and a second runtime on the same state directory.
- [x] 2.4 Add the catalog scenario `agent-sessions`; the catalog's id test went red until it was listed. The six earlier scenarios pass with the real core in place of the stand-in session owner.
- [x] 2.5 In a disposable run the new scenario first failed its health step, which listed the run's harness module beside the core, and `build-current` missed the agent-state and lifecycle-contracts packages the run now loads; the step now checks for no device module, and the adapter watches and serves both builds.

## 3. Reference history

- [x] 3.1 Replay one history through the store and its owner (`tests/reference-history.test.ts`); it went red against #842's root session fixtures (`session-at-5` first).
- [x] 3.2 Regenerate those fixtures with `BUNNY_WRITE_REFERENCE=1`, rename `session-at-5` to `session-at-2`, and keep the event contracts' 164 tests and the SDK's reference scenarios passing.

## 4. Negative controls

- [x] 4.1 Each patched in, run, and reverted; each failed the named test:
  - a publish before the commit: the full-disk store test (`nothing published`);
  - a rejection after the commit: the refused-publication store test (`the change stands, and is reported as taken`);
  - the intake's `(source, id)` kept in memory only: the duplicate-after-restart store test;
  - a freshness change that keeps the old revision: the core's freshness test (the copy never applied it);
  - no source check on acknowledgments: the core's acknowledgment test (`nanoleaf may not acknowledge for pixoo`);
  - messages kept outside the outbox: the process kill test (nothing stored);
  - a stop that does not wait for a start still under way: the core's stop-during-start test (`the stop waited for the start`).

## 5. Docs, checks and the change

- [x] 5.1 Document the core in the runtime README, the decisions in MAPPING.md and the event contracts README, the persisted host session ID in docs/architecture.md, and the fixture core in the adapter README and docs/app-verification.md.
- [x] 5.2 Run build, typecheck, lint, the agent-state, SDK, runtime, scenario, verification, Hub, event and workflow checks, and OpenSpec validation.
- [x] 5.3 Synchronize the affected specifications and archive the change.
