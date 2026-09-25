## 1. Agent-state core

- [x] 1.1 Add `Feeds#listen`/owner `onCommit`: a plain callback registered with no consumer ID, invoked after every `feeds.publish`, isolated by its own try/catch so a throwing listener cannot fault the collector or the triggering commit. Evidence: `packages/agent-state/tests/core.test.mjs` — "a throwing onCommit listener does not fault the collector and the commit still succeeds" and "onCommit fires for both an ordinary commit and a replaceSessions commit, needing no registered consumer".
- [x] 1.2 Bump `VERSION` to `3.1.0` and the package manifest; document `onCommit` in the agent-state README's owner API table.

## 2. Hub push notifications

- [x] 2.1 Replace the per-stream `setInterval` with one shared timer plus an `owner.onCommit` listener that defers its fan-out with `setImmediate`, coalescing a burst into one `advanceFeed` and one write per stream. Add the test-only `feedIntervalMs` hub option, validated like `clock` and left out of `cli.ts`'s configuration allowlist. Evidence: `apps/hub/tests/changes-stream.test.mjs` — a committed event reaches an open stream without waiting for a day-long heartbeat interval; a burst of three commits reaches a reader as one flush without delaying ingest, even with a paused, never-read second stream open; a commit from the in-process Codex Desktop reader reaches an open stream before its own 2-second poll would repeat.
- [x] 2.2 Keep the wire format, the 32-entry replay window, resync-on-unknown-cursor, the 16-stream cap and the 5-second stall disconnect unchanged. Evidence: `apps/hub/tests/http.test.mjs` — "feed publishes quiesced health at the same revision and revocation closes streams" and "aggregate replay retention expires old tickets and rejects them after credential revocation" pass unchanged.
- [x] 2.3 Bump the Hub package to `0.3.1` and its `@jimmie-potts/agent-state` dependency to `3.1.0`; bump the same exact pin in `controllers/tidbyt/package.json`; fix the hardcoded `agent-state` archive filename in `scripts/package-hub.mjs`. Update the agent-state version and `/changes` row in the Hub README.

## 3. Delivery

- [x] 3.1 Run the agent-state, Hub, shared build/type, controller, MCP, dashboard and workflow checks listed in AGENTS.md. `controllers/tidbyt`'s Python check fails only on a pre-existing environment gap (missing `PIL`/Pillow), unrelated to this change; reported rather than fixed. Sync and archive this OpenSpec change on the delivery branch.
