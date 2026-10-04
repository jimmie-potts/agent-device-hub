## Why

The owner wants the CHOMPI's 15 lower keys to act as stable task slots for Codex and Claude Desktop, with Record driving Wispr Flow and an explicit control sending the draft ([#742](https://github.com/jimmie-potts/agent-device-hub/issues/742), epic [#738](https://github.com/jimmie-potts/agent-device-hub/issues/738)). [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741) delivered the bridge's transport and its version 1 event and light interface. The [#740 qualification](../../../docs/chompi-controller-qualification.md#routing-design) chose deep links plus fail-closed verification for both clients, and [#784](https://github.com/jimmie-potts/agent-device-hub/issues/784) adds the Claude Desktop session ID to snapshot 1.3. Wrong-task input is consequential, so every keystroke must follow a verified target.

## What Changes

- Add the routing core under `apps/chompi-bridge/src/routing/`:
  - a versioned JSON profile with strict validation and atomic reload that keeps the last good profile;
  - a read-only Hub feed client for snapshot 1.3 and `/changes` that refetches snapshots and never replays;
  - a private slot store with first-free assignment, deterministic ordering and explicit-only release;
  - a light renderer for slot states;
  - a router that runs the fail-closed focus sequence and gates Record and Send.
- Implement OS adapter interface version 1 for Windows (`apps/chompi-bridge/src/windows/`): deep links, `SendInput` keystrokes, foreground package identity, UI Automation checks and the client archive reads.
- Extend `chompi-bridge run` with `--profile`, `--hub`, `--token-file` and `--state` to compose lock, bridge, feed, router and the Windows adapter. The existing commands keep working.
- Ship a default profile, tests with a fake adapter, fake feed, manual clock and the device simulator, and documentation in the bridge README and `docs/development.md`.

## Capabilities

### New Capabilities

- `chompi-task-routing`: slot assignment and release, state lights, exact-task focus, Record and Send gating, the profile and the Hub feed client.

### Modified Capabilities

- `chompi-bridge`: the OS adapter seam becomes interface version 1 with a Windows implementation instead of a reserved stub.

## Impact

Bridge package only; no Hub, agent-state, lifecycle or controller-contract change. The feed client reads `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and `GET /api/monitor/v1/changes` with a `read`-only credential and falls back to snapshot 1.2 on a Hub that predates #784, where Claude routing stays disabled. Slot state is a new private JSON file on the bridge host. Source-only: installation, live focus, dictation placement and optical results belong to [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743). Knob, model and effort actions belong to [#744](https://github.com/jimmie-potts/agent-device-hub/issues/744).
