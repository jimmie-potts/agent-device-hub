## 1. Validation setup

- [x] 1.1 Register owning module/helper guides, exact test/package scripts, strict compiler/lint coverage and CI before product coding; verify scripts and workspace installation.

## 2. Transport contracts and safety

- [x] 2.1 Implement pure profile-2.0 BB-8 schemas and checks; tests refuse unknown fields, wrong targets, non-allowlisted operations and stale guards.
- [x] 2.2 Build PacketV1 codec/collector with focused red-green-refactor; test fragmented/coalesced/truncated/corrupt input, bounded notifications and matching sequence.
- [x] 2.3 Implement helper receipt admission/effect/result transactions and bounded execution; tests cover failed storage, duplicates, deadlines, disconnect, capacity and every restart boundary with zero replay.
- [x] 2.4 Implement passive Windows entry and lazy native adapter with private enrollment/lock/output capture; fake adapter tests prove only explicit admitted connect loads/accesses BLE and sends selected characteristics.

## 3. Module and integration

- [x] 3.1 Add canonical WSL module state, guarded responders, SDK/simulated transport, private responsibility store and outbox; module-kit tests prove passive reads, public completion persistence and receipt consumption after commit.
- [x] 3.2 Add narrow helper credential/edge grant and MCP exclusion; authenticated integration and negative controls prove ordinary/browser callers cannot become helper owners or request internal effects.
- [x] 3.3 Register both-transport catalog scenarios and synthetic helper/GATT integration; verify LEDs/status, stale evidence, failures, disconnected recovery and no replay on both transports.

## 4. Frontend and package consumers

- [x] 4.1 Add browser-only React controls through shared Command/sync; focused browser/axe tests verify explicit effects, read-only controls, uncertain/unknown/stale evidence, reconnect and unavailable motion.
- [x] 4.2 Verify package export/build consumers and shared compatibility checks; run canonical build/type/lint/workflow/events/Python/SDK/runtime/module/dashboard and browser checks with retained receipts.

Source delivery remains subject to #604 and docs/sdlc.md: synchronize and archive completed implementation artifacts, obtain independent review and CI evidence, merge with a head guard, verify merged-main CI and reconcile the tracker. These delivery gates are recorded in the delivery evidence rather than checked off before they occur. #605 owns installation and physical qualification.
