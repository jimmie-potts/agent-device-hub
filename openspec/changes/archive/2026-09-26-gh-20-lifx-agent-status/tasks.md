## 1. Shared agent-status package

- [x] 1.1 Write failing tests for `sessionState`/`highestStatus` (ranking, idle, unknown for unavailable feed/non-running collector/any uncertain shown session), `HubStatusFeed` (real owner feed, rejected redirect/oversized/malformed/wrong-owner/slow responses), and `EvaluationLoop`/`BoundedReader` (coalescing, stop, a hung read blocking further reads). Then create `packages/agent-status` and implement; verify with `npm run test:agent-status`.
- [x] 1.2 Move `HubStatusFeed` and its GET helpers, the per-session ranking, and the loop/reader out of `controllers/tidbyt`, re-exporting from `runner.ts`/`publishing.ts` so every existing import path and test keeps working unmodified. Verify with `npm run test:tidbyt`.
- [x] 1.3 Add `packages/agent-status` to the root workspaces, build/typecheck chains, `package-lock.json`, `.depot/workflows/ci.yml` and `docs/development.md`.

## 2. LIFX controller: modes and the internal paint

- [x] 2.1 Write failing tests: a qualified bulb advertises `modes:{supported:true,values:["Work","Quiet","Free"]}` and an unqualified one advertises none; `mode.set` sends no bulb traffic and updates `desired.mode` only on a successful persisted write; a bulb with no recorded mode starts Free; a persistence failure reports `failed`/`transport-failure` without changing the mode or bulb health; a persisted mode survives a reconstructed controller; `onModeChange` fires only after a successful `mode.set`. Then implement `modeStateRoot`, `readPersistedMode`/`writePersistedMode` and the `mode.set` branch in `execute()`; verify with `npm run test:lifx`.
- [x] 2.2 Write failing tests for `paintStatus`: one absolute `LightSetColor` with full HSBK and no `LightGet`; visible in `lighting.pending` while queued; a capacity rejection is not retried; a generation cancel or `close()` cancels a queued/in-flight paint; the private command kind is rejected by `parsed()`/`submit()` and the public lighting schema. Then implement `paintStatus`/`executePaint`; verify with `npm run test:lifx`.

## 3. LIFX status publisher

- [x] 3.1 Write failing tests for `LifxStatusPublisher` against a real in-memory agent-state owner and fake timers: mapping (attention/working/done at the brightness cap, idle warm white, Quiet's attention-only key at the quiet cap); transitions only (repeated read, heartbeat, unchanged state send nothing); stale input (unavailable feed and uncertain session send nothing; recovery paints only on a real difference); offline bulb (one bulb's failure never blocks another, and its failed paint is not replayed on an unchanged state); modes (Free never paints, Work paints once on entry, no recorded mode starts Free); a mode persisting across a reconstructed controller; stop halting scheduling. Then implement `controllers/lifx/src/status-publisher.ts`; verify with `npm run test:lifx`.
- [x] 3.2 Document the automatic-status decisions in `controllers/lifx/README.md`.

## 4. Local controller host wiring

- [x] 4.1 Write failing tests in `apps/local-controllers` for the new `lifx.status` feed block and per-bulb `status` block (defaults, out-of-range/fractional caps, unknown fields) and for host startup/shutdown starting and stopping a `LifxStatusPublisher` only when both are present for a qualified bulb, leaving an unconfigured qualified bulb unpainted. Then implement in `config.ts`/`host.ts`; verify with `npm run test:local-controllers`.
- [x] 4.2 Update `apps/local-controllers/README.md` with the new configuration fields and ownership note.

## 5. Dashboard

- [x] 5.1 Write failing tests/checks: the generic mode control and Switch-to-Free extend to LIFX; color and temperature are disabled in Work/Quiet with the ADR 0005 reason and enabled in Free; power and brightness stay mode-independent. Then implement `lifxContentReason`/`lightingReasons` in `client.ts` and the `main.tsx` gating; verify with `npm run test:dashboard` and `npm run test:dashboard:browser` (extending `apps/dashboard/tests/local-controllers.mjs`; `apps/dashboard/tests/layout.mjs` keeps passing).
- [x] 5.2 Capture screenshots for the owner's separate UI approval.

## 6. Delivery

- [x] 6.1 Run build, typecheck, the LIFX, local-controller-host, Tidbyt (Python included), agent-status, contracts, package, MCP, dashboard, hub and workflow checks from the worktree root. Then synchronize the spec deltas below and leave archiving for the coordinator's final-review pass.
- [x] 6.2 Every test that constructs a LIFX controller, publisher or host passes its own temporary mode/lease directory; confirmed no test run leaves files under the developer's real `~/.local/state/agent-device-hub/lifx/` default.

## 7. First-review corrections

- [x] 7.1 Remove the package-level home-directory default for `modeStateRoot`: without one, a qualified bulb advertises `modes: {supported: false}` and `mode.set` is `unsupported-capability`. The host derives `<leaseRoot>/modes` instead. Added a test proving a `mode.set` file lands under the supplied lease root, and a controller-level test for the no-root case.
- [x] 7.2 Match the mode file's safety checks to this codebase's existing private-file/lease rules: directory created at `0700` then required to already be a real owner-only directory; the file opened `O_NOFOLLOW` and required to be a small owner-only regular file to be trusted; the write uses an exclusive, non-following `0600` temporary file and an atomic rename. Added tests for a symlinked mode file and a group-readable mode directory, on both the read and write paths.
- [x] 7.3 `paintStatus` on an unqualified bulb now returns `unsupported-capability` with no traffic and no pending entry (defense in depth). Added a test.
- [x] 7.4 Added `Bulb#closeGracefully`/`LifxController#closeGracefully`: retires queued jobs by bumping the generation without aborting an in-flight one, then awaits the bulb's drain-to-empty cycle before closing the transport. The host now calls it (after stopping the status publisher) in place of the abrupt `close()`. Added a controller-level test: one paint in flight and two queued at close — the in-flight receipt is `sent`, the queued ones are `cancelled` with `priorEffects: "none"`, and the fake transport sees no write after the in-flight one.
- [x] 7.5 Added the two missing transitions cases: new evidence for an unchanged shown state sends no write, and a manual app-change read (via `refresh`) survives repeated reads/heartbeats/new-evidence reads and is overwritten only at the next real transition.
- [x] 7.6 Re-ran the affected checks (lifx, local-controllers, agent-status, tidbyt, dashboard, dashboard:browser, build, typecheck, check:workflow, test:workflow) and updated this change's design.md and spec deltas to match the corrected behavior.
