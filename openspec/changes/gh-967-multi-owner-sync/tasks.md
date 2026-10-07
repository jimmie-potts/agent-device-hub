## 1. Owner-addressed sync in the SDK

- [x] 1.1 Assert on both transports, red against the old code (all 14 new tests failed), that two owners serve `device` and a consumer syncs each by name and gets only that owner's records, live ones included; that a sync with no owner is served by the only owner and refused with `invalid-request` while two serve the family, never reaching either provider; that a named owner that does not serve the family is `unavailable`; that a source serves a family once while another source may serve it too; and that a malformed owner is refused before anything is sent (`packages/sdk/tests/owners.test.ts`).
- [x] 1.2 Assert, red against the old code, that a named copy's later requests keep the owner and an unnamed one sends none, that another owner's traffic never fills a named copy's buffer, and that the edge refuses a malformed owner and passes a valid one to its bus.
- [x] 1.3 Key the in-process registry by source and family, route a request to its named owner or its families' only owner, filter a named copy's live messages by source, and carry the owner beside the request through the remote client and edge.
- [x] 1.4 Change the old one-owner test to the per-source rule (`sync.test.ts`), keeping its split-families and 38-family cases.

## 2. Kit, harness and runtime

- [x] 2.1 Sync a module's served families from the module by name in the kit, add `copies.owner` and its check, and keep a sync's owner in `ModuleHarness.sent`, with a kit test that a module naming the owner passes, one naming none fails only the copies check, and one naming an owner nobody runs fails the lifecycle and copies checks.
- [x] 2.2 Serve the fixture lamp's and sign's own `device/2.0` records, with their kit specs serving `device` against the device schemas.
- [x] 2.3 Start two in-test modules that both serve `device` in a runtime test, with a third module and a remote part through the edge syncing each by name, and a sync with no owner refused and recorded once (`apps/runtime/tests/owners.test.ts`).
- [x] 2.4 Let the catalog's seed name a copy's owner and the reader view read one owner's copy, and add the `device-owners` scenario, which passes over both transports in the in-memory harness and in a disposable run (`test:runtime:verify:built`).

## 3. Docs and qualification

- [x] 3.1 Document the rule, the call shape for a consumer of a shared family and the kit's named-owner checks in the SDK README, where an owner's source comes from in the runtime README, and the `device-owners` run in the verification README.
- [ ] 3.2 Show negative controls fail named tests: ownership keyed by family again, a sync with no owner spread across owners, a named copy that follows every owner's live messages, an edge that drops the owner, and a kit that does not check the named owner.
- [ ] 3.3 Run build, typecheck, lint, the SDK, runtime, scenario, verification, event, maintenance and workflow checks, and OpenSpec validation, on a committed head.
- [ ] 3.4 Synchronize the affected specifications and archive the change.
