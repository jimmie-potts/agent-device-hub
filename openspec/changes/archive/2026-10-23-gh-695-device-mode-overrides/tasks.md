## 1. Choice owner and contracts

- [x] 1.1 Add versioned override state and guarded individual commands; verify the shared contract corpus and synthetic effective-choice consumer.
- [x] 1.2 Extend existing private mode persistence and admission; demonstrate a focused failing test before implementation, then passing migration, isolation, reset, save-failure, busy, duplicate and restart tests.
- [x] 1.3 Expose the command through authenticated HTTP and MCP; verify current global consumers, read-only/raw-command refusal, missing and offline targets, independent outcomes and lost/late responses in runtime tests.

## 2. Existing card interfaces

- [x] 2.1 Reuse the current device cards for individual choices and the Hub card for neutral collapsed exception inspection; verify shared placements, existing Inbox behavior and passive navigation with unit/browser tests.
- [x] 2.2 Verify keyboard, narrow layouts, access, stale/unknown evidence, failed requests and reload without replay with synthetic browser journeys.

## 3. Source verification and documentation

- [x] 3.1 Update the affected runtime, dashboard, module and event-contract guides; check consistency with existing architecture and native control semantics.
- [x] 3.2 Run applicable build/type/lint, contract, runtime, dashboard, module, workflow and scenario checks; preserve red/green evidence and explicit source/installed limits.
- [x] 3.3 Synchronize the affected spec and archive this change after successful current lookups and completed source evidence. The PR/tracker own the subsequent independent review, CI and source closeout.

## Source evidence

The new legacy-store snapshot check failed before implementation and passed afterward. Removing the shared busy guard made the overlap regression fail; restoring the compiled bytes passed. The saved-choice status regression failed when it claimed a device effect and passed with explicit saved-choice wording.

Build, typecheck, JavaScript lint, event contracts (183), SDK (360), runtime (813), runtime scenarios (117), dashboard unit checks (140), Pixoo (341 engine and 99 module), Nanoleaf (558), companions (58), controller contracts/package, Python event/controller checks, workflow checks and dashboard browser journeys passed. The original lamp consumer's Quiet refusal remains asserted under both registered mode versions.

Browser evidence covers existing card placements, keyboard selection, collapsed inspection/navigation without commands, individual/global reset, Pixoo native controls, stale/read-only and uncertain controls, lost replies, restart/reload, narrow layouts and light/dark accessibility. All runtime/device evidence is disposable and synthetic. Independent review, hosted CI and source closeout remain PR/tracker gates; installation and physical acceptance remain outside this delivery.
