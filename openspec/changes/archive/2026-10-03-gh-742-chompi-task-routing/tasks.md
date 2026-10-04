## 1. Acceptance examples and interface

- [x] 1.1 Write the acceptance examples in `design.md` before implementation and map each to named tests (evidence: `design.md` Acceptance examples; `apps/chompi-bridge/tests/routing-*.test.mjs`).
- [x] 1.2 Define OS adapter interface version 1 in `apps/chompi-bridge/src/os-adapter.ts` (evidence: the routing core and the fake adapter compile against it).

## 2. Routing core (red, then green)

- [x] 2.1 Profile: failing tests for the shipped default, strict validation, Send mapping limits, key allowlist and atomic reload; implement `src/routing/profile.ts` and `profiles/default.json` (evidence: `routing-profile.test.mjs`).
- [x] 2.2 Feed: failing tests for snapshot 1.3 with bearer, GET-only requests, refetch on change and resync, coalescing, silence, timeouts, size limits, collector state, 1.2 fallback and token privacy; implement `src/routing/feed.ts` (evidence: `routing-feed.test.mjs`).
- [x] 2.3 Slots: failing tests for first-free order, stability across restarts, explicit release and reuse, overflow, duplicates, root filtering, title cache, release tombstones and the private atomic file; implement `src/routing/slots.ts` and `src/routing/files.ts` (evidence: `routing-slots.test.mjs`).
- [x] 2.4 Lights: failing tests for distinct states, completion color limits, pulse, error and selection overlays, Record and wheel LEDs; implement `src/routing/lights.ts` (evidence: `routing-lights.test.mjs`).
- [x] 2.5 Router: failing tests for every no-misrouting matrix row, Codex and Claude focus, version gate, task switch, Send once, approval and stale-feed refusal, Record, loss, profile reload, release gesture, archive checks and scroll; implement `src/routing/router.ts` (evidence: `routing-router.test.mjs`).
- [x] 2.6 CLI: failing tests for the routing flags, start-up refusals before any device opens, and an end-to-end simulator run; wire `run --profile --hub --token-file --state` in `src/cli.ts` with the platform-guarded adapter loader (evidence: `routing-cli.test.mjs`).

## 3. Windows adapter

- [x] 3.1 Implement OS adapter interface version 1 for Windows under `src/windows/` with its own failing tests first; narrow the profile key names to the adapter's key table and gate both client versions (evidence: `windows-*.test.mjs`, `routing-profile.test.mjs`; native check under Windows Node 24).

## 4. Documentation and validation

- [x] 4.1 Document the profile, CLI and safety rules in `apps/chompi-bridge/README.md` and the routing checks in `docs/development.md`.
- [x] 4.2 Run build, typecheck, the bridge suite and the workflow checks; record results in the PR.
- [x] 4.3 Synchronize the specs and archive this change before final review.
