## 1. Owner read semantics

- [x] 1.1 Keep read evidence out of freshness, restart recovery and session admission. Evidence: `read evidence changes only the read dimension` failed before the reducer and ingest change (an unknown identity was admitted) and passes afterward.

## 2. Hub read-state reader

- [x] 2.1 Parse Desktop's unread marker and derive read decisions for configured top-level Desktop sessions. Evidence: `apps/hub/tests/codex-desktop.test.mjs` failed before the module existed and now covers listed, unlisted after the wait, unlisted within the wait, malformed and changed-format input, and unrelated sessions. Mutating the wait, child, source, version, change-only and unread-to-read rules each fails a test.
- [x] 2.2 Configure, start and stop the poller with the host. Evidence: the host test rejects invalid Desktop configuration and records `unread` through the monitor route from a temporary Codex home; reader tests cover read, unchanged-file, missing-file and new-completion behavior against a real owner.
- [x] 2.3 Document configuration, the source and read rule, and package versions in the owning guides. Evidence: Hub and agent-state READMEs, provider qualification and architecture updated; agent-state 2.0.2 and Hub 0.2.2.

## 3. Delivery

- [x] 3.1 Run the agent-state, Hub, shared build/type, controller, lifecycle, MCP and workflow checks; sync and archive this change. Record exact results in the PR.
