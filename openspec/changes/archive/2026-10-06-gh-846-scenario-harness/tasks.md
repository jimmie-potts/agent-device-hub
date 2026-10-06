## 1. Seam

- [x] 1.1 Expose the module host's bus read-only (`get bus()`), as its own commit with no behavior change; the runtime suite passes unchanged.

## 2. Catalog and tests first

- [x] 2.1 Write the catalog, the harness contract, the runner, the catalog test over both transports and the runner and boundary tests against a harness stub that refuses to start; 18 of the 19 tests fail, and only the catalog's shape check passes.

## 3. Harness and fixtures

- [x] 3.1 Build the in-memory harness: the runtime's module host on a manual clock and scheduler, parts in process or through a `RemoteEdge` on loopback, disconnects, an armed crash and a clean restart on the same state directory and port.
- [x] 3.2 Create modules by factories with their transports: `createLampModule` with `SimulatedLamps`, `createChimeModule` with `SimulatedChime`, and `createCoreModule` for the stand-in core; update the callers. The lamp and the chime pass the module test kit.
- [x] 3.3 Add the lamp's duplicate handling, its failed outcome and its indicator, and the stand-in core's session, history and inbox roles; all 19 scenario tests and the runtime suite pass.

## 4. Negative controls

- [x] 4.1 Each restored, and each failing the scenario at the broken guarantee:
  - a lamp that handles a duplicate `requestId` again fails the end-to-end scenario on both transports at "history keeps one outcome for req-1, and the device switched once";
  - a bus that replays retained occurrences and outcomes to a new subscriber fails "nothing published while it was away reached it" in the reconnect and end-to-end scenarios, on both transports;
  - a lamp that republishes twice at start fails "republished its state, occurrence and outcome, once" on both transports, and a core that never acknowledges fails it and the tracked-outcome scenario's acknowledgment check;
  - a remote client that sends a command again after a lost connection fails the crash answer remotely, and without that step fails "no command was sent again"; a lamp that sends its last switch to the device again at start fails "no command was sent again" on both transports;
  - a remote harness whose parts join the bus in process fails every remote run: the end-to-end scenario at the closing requester's `uncertain-result`, the reconnect scenario at its resync, and the others at "every part reached the runtime through its edge".

## 5. Commands, CI and docs

- [x] 5.1 Add `test:runtime:scenarios` and its `:built` variant, run the `:built` one in the core CI job after `test:runtime:built`, and update the workflow checks.
- [x] 5.2 Document the test layers and the catalog command in docs/development.md, the catalog and fixture modules in the runtime README, the factory convention in the SDK README, and point docs/sdlc.md's tier 2 step at #920.
- [x] 5.3 Run the scenario suite 20 times in sequence and 8 times at once with no failure.
- [x] 5.4 Validate this change with `--strict`, then sync and archive it; `npm run check:workflow`, `npm run test:workflow` and `openspec validate --specs --strict` exit zero.
