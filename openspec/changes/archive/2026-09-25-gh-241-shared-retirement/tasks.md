## 1. Shared owner rule

- [x] 1.1 Demonstrate failing parameterized owner scenarios for Codex CLI and Claude Code (atomic tree removal, one revision, released capacity, unknown/repeated ends, restart, resume, old ordered ends, delayed children), then remove the provider gate from guards, retirement and export validation. Evidence: `packages/agent-state/tests/session-retirement.test.mjs`, `test:agent-state`.
- [x] 1.2 Verify mixed paths: ending one path's last session, including a shared session ID, preserves the other paths and acknowledges nothing; a fresh same-identity start creates a new generation. Evidence: the mixed-path owner test.
- [x] 1.3 Verify completion, waiting, interruption, acknowledgment, child completion, freshness uncertainty and turns over 30 minutes retain records on every path, with the fake-clock 24-hour fallback and the existing retention suite. Evidence: the parameterized retention scenario, `retention.test.mjs`, `core.test.mjs`.

## 2. Upgrade and mappings

- [x] 2.1 Settle stored accepted ends (activity `ended`) and known descendants at startup in one revision with guards, no journal row, acknowledgment, clock reset or replay; retain idle/waiting/unknown records. Verify with a legacy-state fixture for format 1.0 and 2.0. Evidence: the upgraded-store owner test.
- [x] 2.2 Record per-path end/start mapping evidence and installed gaps from the Claude Code and Codex hook references; assert the normalizer never copies `reason` or `source`. Evidence: `docs/provider-qualification.md`, `providers.test.mjs`.

## 3. Consumers, documentation and validation

- [x] 3.1 Parameterize the Tidbyt publisher, dashboard browser and Pixoo/Nanoleaf harness checks over the three paths, including other-path preservation in the dashboard; change a consumer only for a demonstrated gap. Evidence: `test:tidbyt`, `test:dashboard:browser`, three `check-session-retirement.mjs` receipts.
- [x] 3.2 Update the lifecycle contract, provider qualification, package/hub guides, architecture, development checks and compatibility assessment; bump Agent State to 3.2.0 and Hub to 0.3.4.
- [x] 3.3 Run the shared build/type, contract, lifecycle, state, MCP, hub/setup, Tidbyt, dashboard, workflow and package checks from the worktree root and retain results outside the candidate.

Synchronize the affected specifications and archive this change before final independent review. Current-head CI, guarded merge, merged-main checks and issue readback remain SDLC gates. Installed CLI/Claude end and resume qualification remains separately authorized.
